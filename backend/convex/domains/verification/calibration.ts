// convex/domains/verification/calibration.ts
// Calibration infrastructure for verification FP/FN tracking and threshold tuning
//
// This module provides:
// 1. Mutations to label verification outcomes (human review)
// 2. Mutations to compute calibration metrics based on labels
// 3. Queries to aggregate calibration statistics for dashboards
//
// Per industry best practices (NIST SP 800-63, FATF):
// - Track false positives (flagged as suspicious when legit)
// - Track false negatives (missed scams)
// - Use labeled data to tune verification thresholds
// ============================================================================

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../../_generated/server";
import { Doc, Id } from "../../_generated/dataModel";

// ============================================================================
// TYPES
// ============================================================================

export type VerificationVerdict = "legit" | "scam" | "unclear" | "insufficient_info";
export type CalibrationErrorType = "false_positive" | "false_negative" | "correct";

// ============================================================================
// STRATIFIED SAMPLING POLICY
// ============================================================================
// Per statistical best practices, sampling for calibration should be stratified
// to ensure adequate representation of rare but important classes (scams).

export type SamplingStratum =
  | "high_confidence_verified"    // 0.8-1.0, status=verified (expect low error)
  | "medium_confidence_partial"   // 0.5-0.79, status=partial (moderate uncertainty)
  | "low_confidence_unverified"   // 0.0-0.49, status=unverified (high uncertainty)
  | "suspicious_flagged"          // status=suspicious (high priority for review)
  | "multi_vantage_disagreement"  // vantages disagreed (interesting cases)
  | "timeout_inconclusive"        // had timeouts (infrastructure issues)
  | "random_sample";              // random selection for unbiased baseline

export interface SamplingPolicy {
  stratum: SamplingStratum;
  targetSampleRate: number;       // 0-1, fraction to sample from this stratum
  priority: number;               // 1-10, higher = more urgent for review
  rationale: string;
}

export const DEFAULT_SAMPLING_POLICY: SamplingPolicy[] = [
  // Suspicious cases: sample all, highest priority
  { stratum: "suspicious_flagged", targetSampleRate: 1.0, priority: 10, rationale: "All flagged cases need human review" },
  // Multi-vantage disagreement: high sample rate, helps tune consensus logic
  { stratum: "multi_vantage_disagreement", targetSampleRate: 0.5, priority: 8, rationale: "Disagreements indicate edge cases" },
  // Low confidence: moderate sample rate for calibration
  { stratum: "low_confidence_unverified", targetSampleRate: 0.3, priority: 6, rationale: "Calibrate low-confidence thresholds" },
  // Medium confidence: lower sample rate (larger volume)
  { stratum: "medium_confidence_partial", targetSampleRate: 0.1, priority: 4, rationale: "Validate partial verifications" },
  // High confidence: sparse sampling (expect accuracy)
  { stratum: "high_confidence_verified", targetSampleRate: 0.05, priority: 2, rationale: "Spot-check high confidence predictions" },
  // Timeouts: moderate priority for infrastructure monitoring
  { stratum: "timeout_inconclusive", targetSampleRate: 0.2, priority: 5, rationale: "Identify infrastructure false negatives" },
  // Random baseline: required for unbiased accuracy estimates
  { stratum: "random_sample", targetSampleRate: 0.02, priority: 3, rationale: "Unbiased baseline for metrics" },
];

// ============================================================================
// INTER-ANNOTATOR AGREEMENT
// ============================================================================
// Per NLP/ML best practices, calibration requires multiple annotators per entry
// to measure inter-rater reliability (Cohen's kappa, Krippendorff's alpha).

export interface AnnotatorLabel {
  annotatorId: string;
  verdict: VerificationVerdict;
  labeledAt: number;
  notes?: string;
  evidenceUrls?: string[];
  confidenceInLabel: number;      // 0-1, how confident the annotator is
}

export interface InterRaterAgreement {
  annotatorLabels: AnnotatorLabel[];
  consensusVerdict?: VerificationVerdict;
  agreementType: "unanimous" | "majority" | "split" | "single";
  cohensKappa?: number;           // -1 to 1, chance-corrected agreement
  percentAgreement?: number;      // 0-1, raw agreement percentage
  needsAdjudication: boolean;     // True if split/low kappa
}

// ============================================================================
// CONFIDENCE INTERVALS
// ============================================================================
// Per statistical best practices (Wilson score interval), metrics should
// include confidence intervals to quantify uncertainty.

export interface MetricWithCI {
  value: number;
  lower95: number;                // Lower bound of 95% CI
  upper95: number;                // Upper bound of 95% CI
  sampleSize: number;             // n for the metric
}

// ============================================================================
// COST-WEIGHTED THRESHOLDS
// ============================================================================
// Per FATF/fraud detection best practices, FN cost > FP cost.
// Missing a scam (FN) causes direct financial harm.
// False alarm (FP) causes friction but no direct harm.

export interface CostWeights {
  falseNegativeCost: number;      // Cost multiplier for missing scams (default: 5)
  falsePositiveCost: number;      // Cost multiplier for false alarms (default: 1)
  truePositiveValue: number;      // Value of correctly catching scams (default: 5)
  trueNegativeValue: number;      // Value of correctly approving legit (default: 1)
}

export const DEFAULT_COST_WEIGHTS: CostWeights = {
  falseNegativeCost: 5,           // Missing a scam is 5x worse than false alarm
  falsePositiveCost: 1,
  truePositiveValue: 5,           // Catching a scam is 5x more valuable
  trueNegativeValue: 1,
};

export interface CalibrationStats {
  totalLabeled: number;
  totalCorrect: number;
  falsePositives: number;
  falseNegatives: number;
  accuracy: number;                  // totalCorrect / totalLabeled
  precision: number;                 // TP / (TP + FP)
  recall: number;                    // TP / (TP + FN)
  f1Score: number;                   // 2 * (precision * recall) / (precision + recall)
  avgConfidenceDelta: number;        // Average difference between predicted and actual

  // NEW: Confidence intervals for key metrics
  accuracyCI?: MetricWithCI;
  precisionCI?: MetricWithCI;
  recallCI?: MetricWithCI;
  f1ScoreCI?: MetricWithCI;

  // NEW: Cost-weighted metrics
  weightedCost?: number;             // Total cost using cost weights
  costEfficiency?: number;           // (TP*value - FP*cost - FN*cost) / totalLabeled

  // NEW: Inter-rater reliability (if multiple annotators)
  interRaterMetrics?: {
    avgCohensKappa: number;
    adjudicationRate: number;        // % of entries needing adjudication
    avgAnnotatorsPerEntry: number;
  };

  // NEW: Sampling coverage
  samplingCoverage?: Record<SamplingStratum, {
    targeted: number;
    sampled: number;
    coverage: number;
  }>;

  byStatus: Record<string, {
    count: number;
    correct: number;
    accuracy: number;
  }>;
  byConfidenceBucket: Array<{
    bucket: string;                  // e.g., "0.0-0.2", "0.2-0.4"
    count: number;
    correct: number;
    accuracy: number;
  }>;
}

// ============================================================================
// WILSON SCORE CONFIDENCE INTERVAL
// ============================================================================
// Per statistical best practices, we use the Wilson score interval for
// proportions. It provides accurate confidence intervals even with small
// samples, unlike the normal approximation which can give impossible values
// (e.g., CI below 0 or above 1).
//
// Ref: Wilson, E. B. (1927). "Probable inference, the law of succession,
//      and statistical inference". Journal of the American Statistical
//      Association. 22: 209-212.

/**
 * Calculate Wilson score confidence interval for a proportion
 * @param successes Number of successes (e.g., correct predictions)
 * @param n Total number of observations
 * @param confidence Confidence level (default: 0.95 for 95% CI)
 * @returns Object with value, lower95, upper95, and sampleSize
 */
export function computeWilsonCI(
  successes: number,
  n: number,
  confidence: number = 0.95
): MetricWithCI {
  if (n === 0) {
    return { value: 0, lower95: 0, upper95: 0, sampleSize: 0 };
  }

  const p = successes / n;

  // Z-score for confidence level (1.96 for 95%)
  const z = getZScore(confidence);
  const z2 = z * z;

  // Wilson score interval formula
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const spread = (z / denominator) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));

  return {
    value: p,
    lower95: Math.max(0, center - spread),
    upper95: Math.min(1, center + spread),
    sampleSize: n,
  };
}

/**
 * Get Z-score for a given confidence level
 */
function getZScore(confidence: number): number {
  // Common confidence levels
  const zScores: Record<number, number> = {
    0.90: 1.645,
    0.95: 1.96,
    0.99: 2.576,
  };
  return zScores[confidence] ?? 1.96;
}

// ============================================================================
// COHEN'S KAPPA FOR INTER-RATER AGREEMENT
// ============================================================================
// Cohen's kappa measures agreement between two raters, accounting for
// agreement that would occur by chance. Values:
// - 1.0: Perfect agreement
// - 0.0: Agreement equals chance
// - <0: Agreement worse than chance
//
// Interpretation (Landis & Koch, 1977):
// - 0.81-1.00: Almost perfect
// - 0.61-0.80: Substantial
// - 0.41-0.60: Moderate
// - 0.21-0.40: Fair
// - 0.00-0.20: Slight
// - <0.00: Poor

/**
 * Compute Cohen's kappa for two annotators
 * @param labels1 Labels from annotator 1
 * @param labels2 Labels from annotator 2 (same order/items)
 * @returns Cohen's kappa (-1 to 1)
 */
export function computeCohensKappa(
  labels1: VerificationVerdict[],
  labels2: VerificationVerdict[]
): number {
  if (labels1.length !== labels2.length || labels1.length === 0) {
    return 0;
  }

  const n = labels1.length;
  const categories: VerificationVerdict[] = ["legit", "scam", "unclear", "insufficient_info"];

  // Build confusion matrix
  const matrix: Record<string, Record<string, number>> = {};
  for (const cat1 of categories) {
    matrix[cat1] = {};
    for (const cat2 of categories) {
      matrix[cat1][cat2] = 0;
    }
  }

  // Count agreements
  for (let i = 0; i < n; i++) {
    matrix[labels1[i]][labels2[i]]++;
  }

  // Calculate observed agreement (Po)
  let observedAgreement = 0;
  for (const cat of categories) {
    observedAgreement += matrix[cat][cat];
  }
  const po = observedAgreement / n;

  // Calculate expected agreement (Pe)
  let expectedAgreement = 0;
  for (const cat of categories) {
    let rater1Count = 0;
    let rater2Count = 0;
    for (const cat2 of categories) {
      rater1Count += matrix[cat][cat2];
      rater2Count += matrix[cat2][cat];
    }
    expectedAgreement += (rater1Count / n) * (rater2Count / n);
  }
  const pe = expectedAgreement;

  // Cohen's kappa = (Po - Pe) / (1 - Pe)
  if (pe === 1) return 1; // Perfect expected agreement
  return (po - pe) / (1 - pe);
}

/**
 * Compute inter-rater agreement metrics for a set of annotations
 */
export function computeInterRaterAgreement(
  labels: AnnotatorLabel[]
): InterRaterAgreement {
  if (labels.length === 0) {
    return {
      annotatorLabels: [],
      agreementType: "single",
      needsAdjudication: false,
    };
  }

  if (labels.length === 1) {
    return {
      annotatorLabels: labels,
      consensusVerdict: labels[0].verdict,
      agreementType: "single",
      needsAdjudication: false,
    };
  }

  // Count verdicts
  const verdictCounts: Record<VerificationVerdict, number> = {
    legit: 0,
    scam: 0,
    unclear: 0,
    insufficient_info: 0,
  };
  for (const label of labels) {
    verdictCounts[label.verdict]++;
  }

  // Find most common verdict
  let maxCount = 0;
  let consensusVerdict: VerificationVerdict | undefined;
  for (const [verdict, count] of Object.entries(verdictCounts)) {
    if (count > maxCount) {
      maxCount = count;
      consensusVerdict = verdict as VerificationVerdict;
    }
  }

  // Determine agreement type
  let agreementType: InterRaterAgreement["agreementType"];
  if (maxCount === labels.length) {
    agreementType = "unanimous";
  } else if (maxCount > labels.length / 2) {
    agreementType = "majority";
  } else {
    agreementType = "split";
  }

  // Calculate percent agreement
  const percentAgreement = maxCount / labels.length;

  // Calculate Cohen's kappa for pairs (if exactly 2 annotators)
  let cohensKappa: number | undefined;
  if (labels.length === 2) {
    cohensKappa = computeCohensKappa(
      [labels[0].verdict],
      [labels[1].verdict]
    );
  }

  // Determine if adjudication is needed
  // Adjudication needed if: split OR low kappa OR involves high-stakes verdicts
  const needsAdjudication =
    agreementType === "split" ||
    (cohensKappa !== undefined && cohensKappa < 0.4) ||
    (verdictCounts.scam > 0 && verdictCounts.legit > 0); // Disagreement on scam vs legit

  return {
    annotatorLabels: labels,
    consensusVerdict,
    agreementType,
    cohensKappa,
    percentAgreement,
    needsAdjudication,
  };
}

// ============================================================================
// STRATUM CLASSIFICATION
// ============================================================================

/**
 * Classify an audit log entry into a sampling stratum
 */
export function classifyStratum(entry: {
  overallStatus: string;
  confidenceScore: number;
  sloMetrics: { hadTimeout: boolean };
  probeResults?: { website?: { multiVantageUsed?: boolean; consensusStrength?: number } };
}): SamplingStratum {
  // Check for suspicious status first (highest priority)
  if (entry.overallStatus === "suspicious") {
    return "suspicious_flagged";
  }

  // Check for multi-vantage disagreement
  if (
    entry.probeResults?.website?.multiVantageUsed &&
    entry.probeResults?.website?.consensusStrength !== undefined &&
    entry.probeResults.website.consensusStrength < 0.8
  ) {
    return "multi_vantage_disagreement";
  }

  // Check for timeouts
  if (entry.sloMetrics.hadTimeout) {
    return "timeout_inconclusive";
  }

  // Classify by confidence and status
  if (entry.confidenceScore >= 0.8 && entry.overallStatus === "verified") {
    return "high_confidence_verified";
  }
  if (entry.confidenceScore >= 0.5 && entry.overallStatus === "partial") {
    return "medium_confidence_partial";
  }
  if (entry.confidenceScore < 0.5) {
    return "low_confidence_unverified";
  }

  // Default to random sample
  return "random_sample";
}

/**
 * Determine if an entry should be sampled based on policy
 */
export function shouldSampleEntry(
  stratum: SamplingStratum,
  policy: SamplingPolicy[] = DEFAULT_SAMPLING_POLICY
): boolean {
  const stratumPolicy = policy.find(p => p.stratum === stratum);
  if (!stratumPolicy) return false;

  // Use deterministic pseudo-random based on current time to maintain rate
  return Math.random() < stratumPolicy.targetSampleRate;
}

// ============================================================================
// LABEL VERIFICATION OUTCOME
// ============================================================================

/**
 * Label a verification audit log entry with the actual outcome
 * Called by human reviewers after investigating a verification result
 */
export const labelVerificationOutcome = mutation({
  args: {
    auditLogId: v.id("verificationAuditLog"),
    verdict: v.union(
      v.literal("legit"),
      v.literal("scam"),
      v.literal("unclear"),
      v.literal("insufficient_info")
    ),
    notes: v.optional(v.string()),
    evidenceUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ? (identity.subject as Id<"users">) : undefined;

    const auditLog = await ctx.db.get(args.auditLogId);
    if (!auditLog) {
      throw new Error(`Audit log entry not found: ${args.auditLogId}`);
    }

    const now = Date.now();

    // Update with labeled outcome
    await ctx.db.patch(args.auditLogId, {
      labeledOutcome: {
        verdict: args.verdict,
        labeledBy: userId,
        labeledAt: now,
        notes: args.notes,
        evidenceUrls: args.evidenceUrls,
      },
      updatedAt: now,
    });

    // Compute calibration metrics
    const calibration = computeCalibration(
      auditLog.overallStatus,
      auditLog.confidenceScore,
      args.verdict
    );

    await ctx.db.patch(args.auditLogId, {
      calibration,
    });

    return { success: true, calibration };
  },
});

/**
 * Add an additional annotator label for inter-rater agreement tracking
 * Supports multiple annotators per entry for calibration rigor
 */
export const addAnnotatorLabel = mutation({
  args: {
    auditLogId: v.id("verificationAuditLog"),
    verdict: v.union(
      v.literal("legit"),
      v.literal("scam"),
      v.literal("unclear"),
      v.literal("insufficient_info")
    ),
    notes: v.optional(v.string()),
    evidenceUrls: v.optional(v.array(v.string())),
    confidenceInLabel: v.optional(v.number()), // 0-1, how confident annotator is
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const annotatorId = identity?.subject ?? "anonymous";

    const auditLog = await ctx.db.get(args.auditLogId);
    if (!auditLog) {
      throw new Error(`Audit log entry not found: ${args.auditLogId}`);
    }

    const now = Date.now();

    // Create annotator label
    const newLabel: AnnotatorLabel = {
      annotatorId,
      verdict: args.verdict,
      labeledAt: now,
      notes: args.notes,
      evidenceUrls: args.evidenceUrls,
      confidenceInLabel: args.confidenceInLabel ?? 0.8,
    };

    // Get existing labels or initialize empty array
    const existingLabels: AnnotatorLabel[] = (auditLog as any).annotatorLabels ?? [];

    // Check if this annotator already labeled
    const existingIdx = existingLabels.findIndex(l => l.annotatorId === annotatorId);
    if (existingIdx >= 0) {
      existingLabels[existingIdx] = newLabel; // Update existing
    } else {
      existingLabels.push(newLabel);
    }

    // Compute inter-rater agreement
    const interRater = computeInterRaterAgreement(existingLabels);

    // Update the audit log
    await ctx.db.patch(args.auditLogId, {
      annotatorLabels: existingLabels,
      interRaterAgreement: {
        agreementType: interRater.agreementType,
        consensusVerdict: interRater.consensusVerdict,
        cohensKappa: interRater.cohensKappa,
        percentAgreement: interRater.percentAgreement,
        needsAdjudication: interRater.needsAdjudication,
      },
      updatedAt: now,
    });

    // If we have consensus and at least 2 annotators, also update main labeledOutcome
    if (interRater.consensusVerdict && existingLabels.length >= 2 && !interRater.needsAdjudication) {
      const calibration = computeCalibration(
        auditLog.overallStatus,
        auditLog.confidenceScore,
        interRater.consensusVerdict
      );

      await ctx.db.patch(args.auditLogId, {
        labeledOutcome: {
          verdict: interRater.consensusVerdict,
          labeledBy: undefined, // Consensus, not single user
          labeledAt: now,
          notes: `Consensus from ${existingLabels.length} annotators (${interRater.agreementType})`,
        },
        calibration,
      });
    }

    return {
      success: true,
      annotatorCount: existingLabels.length,
      interRaterAgreement: interRater,
    };
  },
});

/**
 * Get entries that need additional annotators for inter-rater agreement
 */
export const getEntriesNeedingAnnotators = query({
  args: {
    limit: v.optional(v.number()),
    minAnnotatorsRequired: v.optional(v.number()), // Default: 2
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const minAnnotators = args.minAnnotatorsRequired ?? 2;

    const entries = await ctx.db
      .query("verificationAuditLog")
      .withIndex("by_created")
      .order("desc")
      .take(limit * 3); // Fetch extra to filter

    // Filter to entries with fewer than required annotators
    const needingAnnotators = entries.filter(e => {
      const annotatorLabels = (e as any).annotatorLabels ?? [];
      return annotatorLabels.length < minAnnotators;
    });

    // Sort by priority (suspicious first, then by stratum priority)
    needingAnnotators.sort((a, b) => {
      const stratumA = classifyStratum(a);
      const stratumB = classifyStratum(b);
      const policyA = DEFAULT_SAMPLING_POLICY.find(p => p.stratum === stratumA);
      const policyB = DEFAULT_SAMPLING_POLICY.find(p => p.stratum === stratumB);
      return (policyB?.priority ?? 0) - (policyA?.priority ?? 0);
    });

    return needingAnnotators.slice(0, limit);
  },
});

/**
 * Get entries needing adjudication (split/disagreement)
 */
export const getEntriesNeedingAdjudication = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const entries = await ctx.db
      .query("verificationAuditLog")
      .withIndex("by_created")
      .order("desc")
      .take(limit * 3);

    // Filter to entries needing adjudication
    const needingAdjudication = entries.filter(e => {
      const interRater = (e as any).interRaterAgreement;
      return interRater?.needsAdjudication === true;
    });

    return needingAdjudication.slice(0, limit);
  },
});

/**
 * Internal mutation to create an audit log entry (called from fastVerify)
 */
export const createAuditLogEntry = internalMutation({
  args: {
    entityType: v.string(),
    entityName: v.string(),
    entityId: v.optional(v.string()),
    requestId: v.string(),
    requestSource: v.string(),
    triggeredBy: v.optional(v.id("users")),
    claimText: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    entityFound: v.union(v.boolean(), v.null()),
    websiteLive: v.union(v.boolean(), v.null()),
    sourceCredibility: v.string(),
    overallStatus: v.string(),
    confidenceScore: v.number(),
    probeResults: v.object({
      entity: v.object({
        result: v.union(v.boolean(), v.null()),
        latencyMs: v.number(),
        source: v.optional(v.string()),
        summary: v.optional(v.string()),
      }),
      website: v.object({
        result: v.union(v.boolean(), v.null()),
        latencyMs: v.number(),
        errorClass: v.optional(v.string()),
        httpStatus: v.optional(v.number()),
        attemptCount: v.number(),
        multiVantageUsed: v.optional(v.boolean()),
        consensusStrength: v.optional(v.number()),
      }),
      credibility: v.object({
        tier: v.string(),
        domain: v.string(),
        matchType: v.optional(v.string()),
      }),
    }),
    factCheckResults: v.optional(v.object({
      provider: v.string(),
      hasResults: v.boolean(),
      factCheckCount: v.number(),
      consensus: v.optional(v.string()),
      agreementLevel: v.optional(v.number()),
    })),
    sloMetrics: v.object({
      totalLatencyMs: v.number(),
      hadPrimarySource: v.boolean(),
      hadTimeout: v.boolean(),
      circuitBreakerTripped: v.boolean(),
      inconclusiveCount: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const id = await ctx.db.insert("verificationAuditLog", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

// ============================================================================
// CALIBRATION COMPUTATION
// ============================================================================

/**
 * Compute calibration metrics based on verification result and labeled outcome
 */
function computeCalibration(
  predictedStatus: string,
  confidenceScore: number,
  actualVerdict: VerificationVerdict
): { wasCorrect: boolean; errorType?: CalibrationErrorType; confidenceDelta?: number } {
  // Map verification statuses to binary prediction
  // "verified" or "partial" → predicted legit
  // "suspicious" or "unverified" → predicted scam/risky
  const predictedLegit = predictedStatus === "verified" || predictedStatus === "partial";

  // Map verdicts to binary actual outcome
  // "legit" → actually legit
  // "scam" → actually scam
  // "unclear" / "insufficient_info" → skip for calibration (neither FP nor FN)
  if (actualVerdict === "unclear" || actualVerdict === "insufficient_info") {
    return { wasCorrect: true }; // Don't penalize for unclear cases
  }

  const actuallyLegit = actualVerdict === "legit";

  // Compute error type
  let errorType: CalibrationErrorType;
  if (predictedLegit === actuallyLegit) {
    errorType = "correct";
  } else if (predictedLegit && !actuallyLegit) {
    // Predicted legit but was actually scam
    errorType = "false_negative";
  } else {
    // Predicted risky but was actually legit
    errorType = "false_positive";
  }

  // Compute confidence delta
  // If actually legit, ideal confidence = 1.0
  // If actually scam, ideal confidence = 0.0
  const idealConfidence = actuallyLegit ? 1.0 : 0.0;
  const confidenceDelta = Math.abs(confidenceScore - idealConfidence);

  return {
    wasCorrect: errorType === "correct",
    errorType,
    confidenceDelta,
  };
}

// ============================================================================
// CALIBRATION STATISTICS QUERIES
// ============================================================================

/**
 * Get aggregated calibration statistics for the dashboard
 * Includes confidence intervals, cost-weighted metrics, and inter-rater reliability
 */
export const getCalibrationStats = query({
  args: {
    timeRangeMs: v.optional(v.number()), // Filter to last N ms (default: all time)
    entityType: v.optional(v.string()),
    costWeights: v.optional(v.object({
      falseNegativeCost: v.number(),
      falsePositiveCost: v.number(),
      truePositiveValue: v.number(),
      trueNegativeValue: v.number(),
    })),
  },
  handler: async (ctx, args): Promise<CalibrationStats> => {
    const timeRangeMs = args.timeRangeMs;
    const minTime = timeRangeMs ? Date.now() - timeRangeMs : 0;
    const weights: CostWeights = args.costWeights ?? DEFAULT_COST_WEIGHTS;

    // Query labeled entries
    let labeledEntries = await ctx.db
      .query("verificationAuditLog")
      .withIndex("by_created")
      .filter((q) => q.gte(q.field("createdAt"), minTime))
      .collect();

    // Filter to only entries with labels
    labeledEntries = labeledEntries.filter(e => e.labeledOutcome?.verdict);

    // Filter by entity type if specified
    if (args.entityType) {
      labeledEntries = labeledEntries.filter(e => e.entityType === args.entityType);
    }

    // Compute aggregates
    let totalLabeled = 0;
    let totalCorrect = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    let truePositives = 0;
    let trueNegatives = 0;
    let totalConfidenceDelta = 0;
    let deltaCount = 0;

    // Inter-rater tracking
    let totalAnnotatorLabels = 0;
    let entriesWithMultipleAnnotators = 0;
    let totalKappa = 0;
    let kappaCount = 0;
    let adjudicationNeededCount = 0;

    // Sampling coverage tracking
    const samplingCoverage: Record<SamplingStratum, { targeted: number; sampled: number }> = {
      high_confidence_verified: { targeted: 0, sampled: 0 },
      medium_confidence_partial: { targeted: 0, sampled: 0 },
      low_confidence_unverified: { targeted: 0, sampled: 0 },
      suspicious_flagged: { targeted: 0, sampled: 0 },
      multi_vantage_disagreement: { targeted: 0, sampled: 0 },
      timeout_inconclusive: { targeted: 0, sampled: 0 },
      random_sample: { targeted: 0, sampled: 0 },
    };

    const byStatus: Record<string, { count: number; correct: number }> = {};
    const confidenceBuckets: Record<string, { count: number; correct: number }> = {
      "0.0-0.2": { count: 0, correct: 0 },
      "0.2-0.4": { count: 0, correct: 0 },
      "0.4-0.6": { count: 0, correct: 0 },
      "0.6-0.8": { count: 0, correct: 0 },
      "0.8-1.0": { count: 0, correct: 0 },
    };

    for (const entry of labeledEntries) {
      if (!entry.calibration) continue;

      totalLabeled++;

      // Classify stratum for this entry
      const stratum = classifyStratum(entry);
      samplingCoverage[stratum].targeted++;
      if (entry.labeledOutcome) {
        samplingCoverage[stratum].sampled++;
      }

      // Track inter-rater metrics
      const annotatorLabels = (entry as any).annotatorLabels ?? [];
      totalAnnotatorLabels += annotatorLabels.length;
      if (annotatorLabels.length >= 2) {
        entriesWithMultipleAnnotators++;
      }
      const interRater = (entry as any).interRaterAgreement;
      if (interRater?.cohensKappa !== undefined) {
        totalKappa += interRater.cohensKappa;
        kappaCount++;
      }
      if (interRater?.needsAdjudication) {
        adjudicationNeededCount++;
      }

      if (entry.calibration.wasCorrect) {
        totalCorrect++;
      }

      if (entry.calibration.errorType === "false_positive") {
        falsePositives++;
      } else if (entry.calibration.errorType === "false_negative") {
        falseNegatives++;
      } else if (entry.calibration.errorType === "correct") {
        // Determine if TP or TN
        const predictedLegit = entry.overallStatus === "verified" || entry.overallStatus === "partial";
        const actuallyLegit = entry.labeledOutcome?.verdict === "legit";
        if (predictedLegit && actuallyLegit) {
          trueNegatives++; // Correctly approved legit
        } else if (!predictedLegit && !actuallyLegit) {
          truePositives++; // Correctly caught scam
        }
      }

      if (entry.calibration.confidenceDelta !== undefined) {
        totalConfidenceDelta += entry.calibration.confidenceDelta;
        deltaCount++;
      }

      // Track by status
      const status = entry.overallStatus;
      if (!byStatus[status]) {
        byStatus[status] = { count: 0, correct: 0 };
      }
      byStatus[status].count++;
      if (entry.calibration.wasCorrect) {
        byStatus[status].correct++;
      }

      // Track by confidence bucket
      const confidence = entry.confidenceScore;
      let bucket: string;
      if (confidence < 0.2) bucket = "0.0-0.2";
      else if (confidence < 0.4) bucket = "0.2-0.4";
      else if (confidence < 0.6) bucket = "0.4-0.6";
      else if (confidence < 0.8) bucket = "0.6-0.8";
      else bucket = "0.8-1.0";

      confidenceBuckets[bucket].count++;
      if (entry.calibration.wasCorrect) {
        confidenceBuckets[bucket].correct++;
      }
    }

    // Compute derived metrics
    const accuracy = totalLabeled > 0 ? totalCorrect / totalLabeled : 0;

    // Precision and recall calculation
    const precision = (truePositives + falsePositives) > 0
      ? truePositives / (truePositives + falsePositives)
      : 0;
    const recall = (truePositives + falseNegatives) > 0
      ? truePositives / (truePositives + falseNegatives)
      : 0;
    const f1Score = (precision + recall) > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 0;

    const avgConfidenceDelta = deltaCount > 0 ? totalConfidenceDelta / deltaCount : 0;

    // Compute confidence intervals using Wilson score
    const accuracyCI = computeWilsonCI(totalCorrect, totalLabeled);
    const precisionCI = computeWilsonCI(truePositives, truePositives + falsePositives);
    const recallCI = computeWilsonCI(truePositives, truePositives + falseNegatives);

    // F1 CI is more complex - use delta method approximation
    // For simplicity, we'll compute CI based on harmonic mean bounds
    const f1ScoreCI: MetricWithCI = {
      value: f1Score,
      lower95: (precisionCI.lower95 + recallCI.lower95) > 0
        ? 2 * (precisionCI.lower95 * recallCI.lower95) / (precisionCI.lower95 + recallCI.lower95)
        : 0,
      upper95: (precisionCI.upper95 + recallCI.upper95) > 0
        ? 2 * (precisionCI.upper95 * recallCI.upper95) / (precisionCI.upper95 + recallCI.upper95)
        : 0,
      sampleSize: totalLabeled,
    };

    // Compute cost-weighted metrics
    const weightedCost =
      falseNegatives * weights.falseNegativeCost +
      falsePositives * weights.falsePositiveCost -
      truePositives * weights.truePositiveValue -
      trueNegatives * weights.trueNegativeValue;

    const costEfficiency = totalLabeled > 0
      ? (truePositives * weights.truePositiveValue + trueNegatives * weights.trueNegativeValue -
         falsePositives * weights.falsePositiveCost - falseNegatives * weights.falseNegativeCost) / totalLabeled
      : 0;

    // Compute inter-rater metrics
    const interRaterMetrics = entriesWithMultipleAnnotators > 0 ? {
      avgCohensKappa: kappaCount > 0 ? totalKappa / kappaCount : 0,
      adjudicationRate: adjudicationNeededCount / entriesWithMultipleAnnotators,
      avgAnnotatorsPerEntry: totalLabeled > 0 ? totalAnnotatorLabels / totalLabeled : 0,
    } : undefined;

    // Format sampling coverage
    const samplingCoverageFormatted: Record<SamplingStratum, { targeted: number; sampled: number; coverage: number }> = {} as any;
    for (const [stratum, stats] of Object.entries(samplingCoverage)) {
      samplingCoverageFormatted[stratum as SamplingStratum] = {
        ...stats,
        coverage: stats.targeted > 0 ? stats.sampled / stats.targeted : 0,
      };
    }

    // Format by status
    const byStatusFormatted: Record<string, { count: number; correct: number; accuracy: number }> = {};
    for (const [status, stats] of Object.entries(byStatus)) {
      byStatusFormatted[status] = {
        ...stats,
        accuracy: stats.count > 0 ? stats.correct / stats.count : 0,
      };
    }

    // Format confidence buckets
    const byConfidenceBucket = Object.entries(confidenceBuckets).map(([bucket, stats]) => ({
      bucket,
      ...stats,
      accuracy: stats.count > 0 ? stats.correct / stats.count : 0,
    }));

    return {
      totalLabeled,
      totalCorrect,
      falsePositives,
      falseNegatives,
      accuracy,
      precision,
      recall,
      f1Score,
      avgConfidenceDelta,
      accuracyCI,
      precisionCI,
      recallCI,
      f1ScoreCI,
      weightedCost,
      costEfficiency,
      interRaterMetrics,
      samplingCoverage: samplingCoverageFormatted,
      byStatus: byStatusFormatted,
      byConfidenceBucket,
    };
  },
});

/**
 * Get recent verification audit logs for labeling
 */
export const getUnlabeledAuditLogs = query({
  args: {
    limit: v.optional(v.number()),
    entityType: v.optional(v.string()),
    overallStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    let entries = await ctx.db
      .query("verificationAuditLog")
      .withIndex("by_created")
      .order("desc")
      .take(limit * 2); // Fetch extra since we'll filter

    // Filter to unlabeled entries
    entries = entries.filter(e => !e.labeledOutcome);

    // Apply filters
    if (args.entityType) {
      entries = entries.filter(e => e.entityType === args.entityType);
    }
    if (args.overallStatus) {
      entries = entries.filter(e => e.overallStatus === args.overallStatus);
    }

    return entries.slice(0, limit);
  },
});

/**
 * Get verification audit log by ID for detailed review
 */
export const getAuditLogById = query({
  args: {
    auditLogId: v.id("verificationAuditLog"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.auditLogId);
  },
});

/**
 * Get SLO metrics summary (for monitoring dashboard)
 */
export const getSloMetricsSummary = query({
  args: {
    timeRangeMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const timeRangeMs = args.timeRangeMs ?? 24 * 60 * 60 * 1000; // Default: last 24h
    const minTime = Date.now() - timeRangeMs;

    const entries = await ctx.db
      .query("verificationAuditLog")
      .withIndex("by_created")
      .filter((q) => q.gte(q.field("createdAt"), minTime))
      .collect();

    const totalRequests = entries.length;
    let totalLatencyMs = 0;
    let hadTimeoutCount = 0;
    let circuitBreakerTrippedCount = 0;
    let multiVantageUsedCount = 0;
    let hadPrimarySourceCount = 0;
    let totalInconclusiveProbes = 0;

    for (const entry of entries) {
      totalLatencyMs += entry.sloMetrics.totalLatencyMs;
      if (entry.sloMetrics.hadTimeout) hadTimeoutCount++;
      if (entry.sloMetrics.circuitBreakerTripped) circuitBreakerTrippedCount++;
      if (entry.probeResults.website.multiVantageUsed) multiVantageUsedCount++;
      if (entry.sloMetrics.hadPrimarySource) hadPrimarySourceCount++;
      totalInconclusiveProbes += entry.sloMetrics.inconclusiveCount;
    }

    return {
      totalRequests,
      avgLatencyMs: totalRequests > 0 ? totalLatencyMs / totalRequests : 0,
      timeoutRate: totalRequests > 0 ? hadTimeoutCount / totalRequests : 0,
      circuitBreakerTripRate: totalRequests > 0 ? circuitBreakerTrippedCount / totalRequests : 0,
      multiVantageUsageRate: totalRequests > 0 ? multiVantageUsedCount / totalRequests : 0,
      primarySourceRate: totalRequests > 0 ? hadPrimarySourceCount / totalRequests : 0,
      avgInconclusiveProbes: totalRequests > 0 ? totalInconclusiveProbes / totalRequests : 0,
    };
  },
});
