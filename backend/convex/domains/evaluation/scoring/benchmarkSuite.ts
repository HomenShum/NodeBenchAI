/**
 * benchmarkSuite.ts
 *
 * Evaluation benchmark suite for risk-based DD system.
 *
 * Includes test cases for:
 * 1. Known fraud patterns
 * 2. Known legitimate companies
 * 3. Ambiguous cases (edge cases)
 * 4. Identity mismatch scenarios
 * 5. BEC pattern detection
 *
 * Scoring dimensions:
 * - Decision quality (escalate vs not)
 * - Evidence quality (completeness, reliability)
 * - Operator burden (false positive rate)
 */

import { DDTier, DDRiskSignal, DDRiskCategory } from "../../agents/dueDiligence/types";
import { RiskAssessmentInput, detectRiskSignals, calculateRiskScore } from "../../agents/dueDiligence/riskScoring";
import { selectDDTier } from "../../agents/dueDiligence/ddTriggerQueries";
import { DDOutcome, DDOutcomeRecord, calculateCalibration } from "./riskCalibration";
import { IdentityAssuranceLevel, IdentityEvidence, calculateAssuranceLevel } from "../personas/identityAssurance";
import { BECPattern, detectBECPatterns } from "../inference/becPlaybook";

// ============================================================================
// BENCHMARK CASE TYPES
// ============================================================================

/**
 * Expected outcome for a test case
 */
export interface ExpectedOutcome {
  shouldEscalate: boolean;
  minTier: DDTier;
  expectedRiskScoreRange: [number, number];  // [min, max]
  expectedIAL: IdentityAssuranceLevel;
  becPatternsExpected: number;
  groundTruth: DDOutcome;
  notes: string;
}

/**
 * Single benchmark test case
 */
export interface BenchmarkCase {
  id: string;
  name: string;
  category: "fraud" | "legitimate" | "ambiguous" | "identity_mismatch" | "bec_pattern";
  description: string;

  // Input data
  input: RiskAssessmentInput;
  identityEvidence?: IdentityEvidence[];
  communicationText?: string;  // For BEC detection

  // Expected outcome
  expected: ExpectedOutcome;
}

/**
 * Benchmark run result for a single case
 */
export interface BenchmarkCaseResult {
  caseId: string;
  caseName: string;
  category: BenchmarkCase["category"];

  // Actual results
  actualRiskScore: number;
  actualTier: DDTier;
  actualIAL: IdentityAssuranceLevel;
  becPatternsFound: number;
  signalsDetected: DDRiskSignal[];

  // Comparison to expected
  escalationCorrect: boolean;
  tierCorrect: boolean;
  riskScoreInRange: boolean;
  ialCorrect: boolean;
  becDetectionCorrect: boolean;

  // Overall
  passed: boolean;
  failures: string[];
  executionTimeMs: number;
}

/**
 * Full benchmark suite result
 */
export interface BenchmarkSuiteResult {
  suiteId: string;
  runAt: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;

  // By category
  resultsByCategory: Record<BenchmarkCase["category"], {
    total: number;
    passed: number;
    accuracy: number;
  }>;

  // Key metrics
  escalationAccuracy: number;    // Did we escalate when we should?
  falsePositiveRate: number;     // Over-escalation rate
  falseNegativeRate: number;     // Missed escalation rate
  becDetectionAccuracy: number;  // BEC pattern detection rate

  // Individual results
  caseResults: BenchmarkCaseResult[];

  // Summary
  summary: string;
  recommendations: string[];
}

// ============================================================================
// BENCHMARK TEST CASES
// ============================================================================

/**
 * Fraud pattern test cases
 */
export const FRAUD_CASES: BenchmarkCase[] = [
  {
    id: "fraud-001",
    name: "Shell company with no registry presence",
    category: "fraud",
    description: "Company claims $5M seed but doesn't exist in any business registry",
    input: {
      companyName: "TechInnovate Solutions LLC",
      websiteUrl: "techinnovate-solutions.com",
      domainAge: 45,  // Very new
      whoisPrivate: true,
      amountUsd: 5_000_000,
      roundType: "seed",
      foundInRegistry: false,
      fastVerifyResult: {
        entityFound: false,
        websiteLive: true,
        sourceCredibility: "low",
      },
    },
    expected: {
      shouldEscalate: true,
      minTier: "STANDARD_DD",  // $5M = STANDARD_DD, but escalation triggers upgrade
      expectedRiskScoreRange: [15, 50],  // Realistic signal-based score
      expectedIAL: "IAL0",  // No identity evidence provided
      becPatternsExpected: 0,
      groundTruth: "confirmed_fraud",
      notes: "No registry presence is a major red flag",
    },
  },
  {
    id: "fraud-002",
    name: "Founder identity mismatch",
    category: "fraud",
    description: "Founder claims titles that don't match LinkedIn profile",
    input: {
      companyName: "DataDriven AI Inc",
      amountUsd: 2_000_000,
      roundType: "seed",
      founders: [
        {
          name: "John Smith",
          linkedinUrl: "linkedin.com/in/johnsmith123",
          titleVariations: ["CEO", "Founder", "CTO", "Managing Director", "President"],
          employmentGaps: 5,
        },
      ],
      foundInRegistry: true,
    },
    expected: {
      shouldEscalate: true,  // IDENTITY_MISMATCH trigger (5 title variations)
      minTier: "LIGHT_DD",   // $2M seed = LIGHT_DD, but escalation upgrades to FULL_PLAYBOOK
      expectedRiskScoreRange: [10, 30],  // identity_provenance: (4*15 + 1*15) * 15/77 ≈ 14-15
      expectedIAL: "IAL0",   // No identity evidence provided
      becPatternsExpected: 0,
      groundTruth: "confirmed_misrep",
      notes: "Multiple title variations across sources indicates misrepresentation",
    },
  },
  {
    id: "fraud-003",
    name: "Extraordinary claims without sources",
    category: "fraud",
    description: "Company claims FDA approval and $10M ARR with no credible sources",
    input: {
      companyName: "MediTech Innovations",
      amountUsd: 15_000_000,
      roundType: "series-a",
      sectors: ["healthcare"],
      claims: [
        { claim: "FDA approved medical device", isExtraordinary: true, hasSourceUrl: false, sourceReliability: "low" },
        { claim: "$10M ARR in 12 months", isExtraordinary: true, hasSourceUrl: false, sourceReliability: "low" },
        { claim: "Partnership with Mayo Clinic", isExtraordinary: true, hasSourceUrl: false, sourceReliability: "low" },
      ],
      foundInRegistry: true,
    },
    expected: {
      shouldEscalate: true,  // EXTRAORDINARY_CLAIMS trigger (3 extraordinary claims w/o sources)
      minTier: "STANDARD_DD",  // $15M series-a = STANDARD_DD, escalation upgrades to FULL_PLAYBOOK
      expectedRiskScoreRange: [15, 35],  // claims_verification: critical(8*12)+med(2*12)=120→100, sector: med(2*10)=20
      expectedIAL: "IAL0",   // No identity evidence provided
      becPatternsExpected: 0,
      groundTruth: "confirmed_misrep",
      notes: "Multiple extraordinary claims without credible sources",
    },
  },
];

/**
 * Legitimate company test cases
 */
export const LEGITIMATE_CASES: BenchmarkCase[] = [
  {
    id: "legit-001",
    name: "Well-documented Series A",
    category: "legitimate",
    description: "Company with strong registry presence, credible sources, known investors",
    input: {
      companyName: "CloudScale Technologies",
      websiteUrl: "cloudscale.io",
      domainAge: 1200,  // 3+ years old
      amountUsd: 25_000_000,
      roundType: "series-a",
      sectors: ["enterprise"],
      founders: [
        {
          name: "Sarah Chen",
          linkedinUrl: "linkedin.com/in/sarahchen-cloudscale",
          titleVariations: ["CEO", "Co-founder"],  // Only 2 variations, no signal
        },
      ],
      foundInRegistry: true,
      registryMatches: 3,
      fastVerifyResult: {
        entityFound: true,
        websiteLive: true,
        sourceCredibility: "high",
      },
    },
    expected: {
      shouldEscalate: false,  // No escalation triggers
      minTier: "STANDARD_DD",  // $25M series-a = STANDARD_DD
      expectedRiskScoreRange: [0, 15],  // No risk signals detected
      expectedIAL: "IAL0",   // No identity evidence provided
      becPatternsExpected: 0,
      groundTruth: "confirmed_legit",
      notes: "Strong signals, no red flags",
    },
  },
  {
    id: "legit-002",
    name: "Small seed with clean profile",
    category: "legitimate",
    description: "Pre-seed company with limited but consistent information",
    input: {
      companyName: "LocalFirst App",
      websiteUrl: "localfirst.app",
      domainAge: 180,  // > 90 days, no signal
      amountUsd: 500_000,
      roundType: "pre-seed",
      founders: [
        {
          name: "Mike Johnson",
          linkedinUrl: "linkedin.com/in/mikejohnson",
          titleVariations: ["Founder"],  // Only 1 variation, no signal
        },
      ],
      foundInRegistry: true,
      fastVerifyResult: {
        entityFound: true,
        websiteLive: true,
        sourceCredibility: "medium",  // Medium is not low, no signal
      },
    },
    expected: {
      shouldEscalate: false,  // No escalation triggers
      minTier: "FAST_VERIFY",  // $500K pre-seed = FAST_VERIFY
      expectedRiskScoreRange: [0, 10],  // No risk signals detected
      expectedIAL: "IAL0",   // No identity evidence provided
      becPatternsExpected: 0,
      groundTruth: "confirmed_legit",
      notes: "Small deal, limited info but consistent",
    },
  },
];

/**
 * Ambiguous/edge case test cases
 */
export const AMBIGUOUS_CASES: BenchmarkCase[] = [
  {
    id: "ambig-001",
    name: "New company with limited history",
    category: "ambiguous",
    description: "Recently incorporated company raising seed round",
    input: {
      companyName: "NewVenture Tech",
      websiteUrl: "newventure.tech",
      domainAge: 60,  // < 90 days, medium signal
      amountUsd: 1_500_000,
      roundType: "seed",
      founders: [
        {
          name: "Alex Rivera",
          linkedinUrl: undefined,  // No LinkedIn, medium signal
          employmentGaps: 0,
        },
      ],
      foundInRegistry: true,  // Registry found, no ENTITY_NOT_FOUND trigger
      fastVerifyResult: {
        entityFound: false,  // Not found in fast verify, high signal
        websiteLive: true,
        sourceCredibility: "low",  // Low credibility, medium signal
      },
    },
    expected: {
      shouldEscalate: false,  // No escalation triggers (registry IS found)
      minTier: "LIGHT_DD",    // $1.5M seed = LIGHT_DD
      expectedRiskScoreRange: [15, 35],  // identity(2*15) + entity_auth(2*14+4*14) + doc(2*8)
      expectedIAL: "IAL0",    // No identity evidence provided
      becPatternsExpected: 0,
      groundTruth: "unclear",
      notes: "Limited information, but registry presence is positive",
    },
  },
  {
    id: "ambig-002",
    name: "Same-name collision risk",
    category: "ambiguous",
    description: "Company name matches a known bad actor, but different entity",
    input: {
      companyName: "Global Dynamics Inc",  // Common name
      amountUsd: 8_000_000,
      roundType: "series-a",
      foundInRegistry: true,
      registryMatches: 5,  // Multiple matches but no signal for this
      fastVerifyResult: {
        entityFound: true,
        websiteLive: true,
        sourceCredibility: "medium",  // Medium is not low, no signal
      },
    },
    expected: {
      shouldEscalate: false,  // No escalation triggers
      minTier: "STANDARD_DD", // $8M series-a = STANDARD_DD
      expectedRiskScoreRange: [0, 15],  // No risk signals detected
      expectedIAL: "IAL0",    // No identity evidence provided
      becPatternsExpected: 0,
      groundTruth: "unclear",
      notes: "Name collision requires disambiguation, not automatic escalation",
    },
  },
];

/**
 * BEC pattern test cases
 */
export const BEC_CASES: BenchmarkCase[] = [
  {
    id: "bec-001",
    name: "Payment instruction change request",
    category: "bec_pattern",
    description: "Email requesting wire to new bank account",
    input: {
      companyName: "Vendor Corp",
      amountUsd: 100_000,
      roundType: "unknown",
      hasUrgencyLanguage: true,         // Triggers transaction_integrity high signal
      paymentInstructionChanges: true,  // Triggers transaction_integrity critical signal + PAYMENT_ANOMALY
    },
    communicationText: "Please wire the payment to our new bank account. The details have changed. This is urgent and time sensitive. Please process immediately.",
    expected: {
      shouldEscalate: true,   // PAYMENT_ANOMALY trigger from paymentInstructionChanges
      minTier: "FAST_VERIFY", // $100K unknown = FAST_VERIFY, but escalation upgrades to FULL_PLAYBOOK
      expectedRiskScoreRange: [20, 40],  // transaction_integrity: high(4*18)+critical(8*18)=216→100 * 18/77 ≈ 23
      expectedIAL: "IAL0",    // No identity evidence provided
      becPatternsExpected: 2, // payment_instruction_change + urgency
      groundTruth: "confirmed_fraud",
      notes: "Classic BEC pattern - payment change + urgency",
    },
  },
  {
    id: "bec-002",
    name: "CEO impersonation with secrecy",
    category: "bec_pattern",
    description: "Message claiming to be from CEO with secrecy request",
    input: {
      companyName: "Internal Request",
      amountUsd: 50_000,
      roundType: "unknown",
      // NOTE: BEC patterns detected from communicationText will enrich the input
      // The benchmark runner integrates BEC detection with risk assessment
    },
    communicationText: "This is the CEO. I need you to process this payment right away. Keep this confidential and don't tell anyone else. I'm in a meeting so I can't talk.",
    expected: {
      shouldEscalate: true,   // BEC patterns trigger escalation (authority_impersonation is critical)
      minTier: "FAST_VERIFY", // $50K unknown = FAST_VERIFY, but BEC escalation upgrades to FULL_PLAYBOOK
      expectedRiskScoreRange: [0, 30],  // Base input has no flags, BEC adds urgency
      expectedIAL: "IAL0",    // No identity evidence provided
      becPatternsExpected: 3, // authority_impersonation, secrecy_request, urgency
      groundTruth: "confirmed_fraud",
      notes: "CEO impersonation + secrecy + urgency is high-risk BEC",
    },
  },
];

/**
 * All benchmark cases
 */
export const ALL_BENCHMARK_CASES: BenchmarkCase[] = [
  ...FRAUD_CASES,
  ...LEGITIMATE_CASES,
  ...AMBIGUOUS_CASES,
  ...BEC_CASES,
];

// ============================================================================
// BENCHMARK RUNNER
// ============================================================================

/**
 * Run a single benchmark case
 */
export function runBenchmarkCase(testCase: BenchmarkCase): BenchmarkCaseResult {
  const startTime = Date.now();
  const failures: string[] = [];

  // Detect BEC patterns first (they can contribute to escalation)
  let becPatternsFound = 0;
  let becPatterns: BECPattern[] = [];
  if (testCase.communicationText) {
    becPatterns = detectBECPatterns(testCase.communicationText);
    becPatternsFound = becPatterns.length;
  }

  // Detect risk signals
  const signals = detectRiskSignals(testCase.input);
  const riskResult = calculateRiskScore(signals);

  // BEC patterns can add escalation triggers
  // Critical BEC patterns (authority_impersonation, payment_instruction_change) should escalate
  const becEscalationTriggers: string[] = [];
  for (const pattern of becPatterns) {
    if (pattern.type === "authority_impersonation") {
      becEscalationTriggers.push("BEC_AUTHORITY_IMPERSONATION");
    }
    if (pattern.type === "payment_instruction_change") {
      becEscalationTriggers.push("BEC_PAYMENT_CHANGE");
    }
  }

  // Combine risk-based and BEC-based escalation triggers
  const allEscalationTriggers = [...riskResult.escalationTriggers, ...becEscalationTriggers];

  // Determine tier using combined funding + risk selection
  const tierResult = selectDDTier(
    testCase.input.amountUsd,
    testCase.input.roundType || "unknown",
    riskResult.overall,
    allEscalationTriggers
  );
  const actualTier = tierResult.tier;
  const actualRiskScore = riskResult.overall;

  // Calculate IAL
  const ialResult = calculateAssuranceLevel(testCase.identityEvidence ?? []);
  const actualIAL = ialResult.level;

  // Check expectations
  const { expected } = testCase;

  // Escalation check - includes both risk triggers and BEC triggers
  const didEscalate = tierResult.wasOverridden || allEscalationTriggers.length > 0;
  const escalationCorrect = didEscalate === expected.shouldEscalate;
  if (!escalationCorrect) {
    failures.push(`Escalation: expected ${expected.shouldEscalate}, got ${didEscalate}`);
  }

  // Tier check
  const tierRanking = ["FAST_VERIFY", "LIGHT_DD", "STANDARD_DD", "FULL_PLAYBOOK"];
  const tierCorrect = tierRanking.indexOf(actualTier) >= tierRanking.indexOf(expected.minTier);
  if (!tierCorrect) {
    failures.push(`Tier: expected at least ${expected.minTier}, got ${actualTier}`);
  }

  // Risk score range check
  const [minScore, maxScore] = expected.expectedRiskScoreRange;
  const riskScoreInRange = actualRiskScore >= minScore && actualRiskScore <= maxScore;
  if (!riskScoreInRange) {
    failures.push(`Risk score: expected ${minScore}-${maxScore}, got ${actualRiskScore}`);
  }

  // IAL check
  const ialCorrect = actualIAL === expected.expectedIAL;
  if (!ialCorrect) {
    failures.push(`IAL: expected ${expected.expectedIAL}, got ${actualIAL}`);
  }

  // BEC detection check
  const becDetectionCorrect = becPatternsFound >= expected.becPatternsExpected;
  if (!becDetectionCorrect) {
    failures.push(`BEC patterns: expected >= ${expected.becPatternsExpected}, got ${becPatternsFound}`);
  }

  const passed = failures.length === 0;

  return {
    caseId: testCase.id,
    caseName: testCase.name,
    category: testCase.category,
    actualRiskScore,
    actualTier,
    actualIAL,
    becPatternsFound,
    signalsDetected: signals,
    escalationCorrect,
    tierCorrect,
    riskScoreInRange,
    ialCorrect,
    becDetectionCorrect,
    passed,
    failures,
    executionTimeMs: Date.now() - startTime,
  };
}

/**
 * Run full benchmark suite
 */
export function runBenchmarkSuite(
  cases: BenchmarkCase[] = ALL_BENCHMARK_CASES
): BenchmarkSuiteResult {
  const suiteId = `bench-${Date.now()}`;
  const runAt = Date.now();

  const caseResults = cases.map(runBenchmarkCase);

  // Calculate results by category
  const categories: BenchmarkCase["category"][] = ["fraud", "legitimate", "ambiguous", "identity_mismatch", "bec_pattern"];
  const resultsByCategory: BenchmarkSuiteResult["resultsByCategory"] = {} as any;

  for (const category of categories) {
    const categoryResults = caseResults.filter(r => r.category === category);
    resultsByCategory[category] = {
      total: categoryResults.length,
      passed: categoryResults.filter(r => r.passed).length,
      accuracy: categoryResults.length > 0
        ? categoryResults.filter(r => r.passed).length / categoryResults.length
        : 0,
    };
  }

  // Calculate key metrics
  const totalCases = caseResults.length;
  const passedCases = caseResults.filter(r => r.passed).length;
  const failedCases = totalCases - passedCases;

  // Escalation accuracy
  const escalationCorrect = caseResults.filter(r => r.escalationCorrect).length;
  const escalationAccuracy = escalationCorrect / totalCases;

  // False positive/negative rates
  const shouldHaveEscalated = cases.filter(c => c.expected.shouldEscalate).length;
  const shouldNotHaveEscalated = cases.length - shouldHaveEscalated;

  const missedEscalations = caseResults.filter((r, i) =>
    cases[i].expected.shouldEscalate && !r.escalationCorrect
  ).length;
  const overEscalations = caseResults.filter((r, i) =>
    !cases[i].expected.shouldEscalate && !r.escalationCorrect
  ).length;

  const falseNegativeRate = shouldHaveEscalated > 0
    ? missedEscalations / shouldHaveEscalated
    : 0;
  const falsePositiveRate = shouldNotHaveEscalated > 0
    ? overEscalations / shouldNotHaveEscalated
    : 0;

  // BEC detection accuracy
  const becCases = cases.filter(c => c.expected.becPatternsExpected > 0);
  const becCorrect = caseResults.filter((r, i) =>
    becCases.some(bc => bc.id === cases[i].id) && r.becDetectionCorrect
  ).length;
  const becDetectionAccuracy = becCases.length > 0
    ? becCorrect / becCases.length
    : 1;

  // Generate recommendations
  const recommendations: string[] = [];

  if (falseNegativeRate > 0.1) {
    recommendations.push(`High miss rate (${(falseNegativeRate * 100).toFixed(0)}%). Consider lowering escalation thresholds.`);
  }
  if (falsePositiveRate > 0.2) {
    recommendations.push(`High false positive rate (${(falsePositiveRate * 100).toFixed(0)}%). Consider raising thresholds or improving signals.`);
  }
  if (resultsByCategory.fraud?.accuracy < 0.8) {
    recommendations.push(`Fraud detection accuracy low (${((resultsByCategory.fraud?.accuracy ?? 0) * 100).toFixed(0)}%). Review fraud signal weights.`);
  }
  if (becDetectionAccuracy < 0.9) {
    recommendations.push(`BEC detection needs improvement (${(becDetectionAccuracy * 100).toFixed(0)}%). Add more BEC patterns.`);
  }

  // Summary
  const summary = `Benchmark: ${passedCases}/${totalCases} passed (${((passedCases / totalCases) * 100).toFixed(0)}%). ` +
    `Escalation accuracy: ${(escalationAccuracy * 100).toFixed(0)}%. ` +
    `FP: ${(falsePositiveRate * 100).toFixed(0)}%, FN: ${(falseNegativeRate * 100).toFixed(0)}%.`;

  return {
    suiteId,
    runAt,
    totalCases,
    passedCases,
    failedCases,
    resultsByCategory,
    escalationAccuracy,
    falsePositiveRate,
    falseNegativeRate,
    becDetectionAccuracy,
    caseResults,
    summary,
    recommendations,
  };
}

/**
 * Format benchmark results for display
 */
export function formatBenchmarkResults(results: BenchmarkSuiteResult): string {
  const lines: string[] = [];

  lines.push("=== BENCHMARK SUITE RESULTS ===");
  lines.push(`Run: ${new Date(results.runAt).toISOString()}`);
  lines.push("");
  lines.push(results.summary);
  lines.push("");

  lines.push("BY CATEGORY:");
  for (const [category, metrics] of Object.entries(results.resultsByCategory)) {
    if (metrics.total > 0) {
      lines.push(`  ${category}: ${metrics.passed}/${metrics.total} (${(metrics.accuracy * 100).toFixed(0)}%)`);
    }
  }
  lines.push("");

  if (results.recommendations.length > 0) {
    lines.push("RECOMMENDATIONS:");
    for (const rec of results.recommendations) {
      lines.push(`  - ${rec}`);
    }
    lines.push("");
  }

  if (results.failedCases > 0) {
    lines.push("FAILED CASES:");
    for (const result of results.caseResults.filter(r => !r.passed)) {
      lines.push(`  [${result.category}] ${result.caseName}`);
      for (const failure of result.failures) {
        lines.push(`    - ${failure}`);
      }
    }
  }

  return lines.join("\n");
}
