/**
 * riskCalibration.ts
 *
 * Risk score calibration and drift monitoring system.
 *
 * KEY INSIGHT: A risk score that "adds up" is not the same as one that's
 * PREDICTIVE and STABLE. Without calibration, thresholds will drift.
 *
 * This module provides:
 * 1. Outcome tracking (confirmed_legit, confirmed_misrep, confirmed_fraud, unclear)
 * 2. Calibration metrics (precision/recall by category, reliability curves)
 * 3. Threshold tuning recommendations
 * 4. Explainability artifacts (top signals, evidence, why weights fired)
 *
 * Based on risk-based approach guidance (FATF, FinCEN FIN-2016-A003)
 */

import { DDRiskCategory, DDRiskSignal, DDTier } from "../../agents/dueDiligence/types";

// ============================================================================
// OUTCOME TYPES
// ============================================================================

/**
 * Verified outcome labels for calibration
 */
export type DDOutcome =
  | "confirmed_legit"      // Company verified as legitimate
  | "confirmed_misrep"     // Material misrepresentation found
  | "confirmed_fraud"      // Confirmed fraudulent activity
  | "unclear";             // Insufficient data to determine

/**
 * Outcome record for tracking DD results
 */
export interface DDOutcomeRecord {
  id: string;
  jobId: string;
  entityName: string;
  entityType: "company" | "fund" | "person";

  // Risk assessment at time of DD
  riskScore: number;
  riskCategory: DDRiskCategory;
  tier: DDTier;
  signals: DDRiskSignal[];
  escalationTriggers: string[];

  // Verified outcome (set post-DD, often manually)
  outcome: DDOutcome;
  outcomeSource: "manual_review" | "automated" | "external_report" | "followup_dd";
  outcomeNotes?: string;
  outcomeTimestamp: number;

  // Metadata
  sector?: string;
  fundingStage?: string;
  amountUsd?: number;
  createdAt: number;
}

// ============================================================================
// CALIBRATION METRICS
// ============================================================================

/**
 * Calibration metrics for a risk category
 */
export interface CategoryCalibration {
  category: DDRiskCategory;
  totalSamples: number;

  // Confusion matrix
  truePositives: number;   // High risk + bad outcome
  falsePositives: number;  // High risk + good outcome
  trueNegatives: number;   // Low risk + good outcome
  falseNegatives: number;  // Low risk + bad outcome

  // Derived metrics
  precision: number;       // TP / (TP + FP)
  recall: number;          // TP / (TP + FN)
  f1Score: number;         // 2 * (precision * recall) / (precision + recall)

  // Calibration quality
  brierScore: number;      // Mean squared error of probability estimates
  calibrationError: number; // |predicted_prob - observed_freq|

  // Recommendations
  recommendedWeightAdjustment: number; // Multiplier suggestion
  driftWarning: boolean;
}

/**
 * Overall calibration report
 */
export interface CalibrationReport {
  reportId: string;
  generatedAt: number;
  samplePeriodStart: number;
  samplePeriodEnd: number;
  totalOutcomes: number;

  // By category
  categoryMetrics: CategoryCalibration[];

  // By tier
  tierAccuracy: Record<DDTier, {
    total: number;
    correctEscalations: number;
    missedEscalations: number;
    overEscalations: number;
    accuracy: number;
  }>;

  // Overall
  overallPrecision: number;
  overallRecall: number;
  overallF1: number;

  // Threshold recommendations
  thresholdRecommendations: {
    tier: DDTier;
    currentMin: number;
    recommendedMin: number;
    reason: string;
  }[];

  // Drift alerts
  driftAlerts: {
    category: DDRiskCategory;
    metric: string;
    previousValue: number;
    currentValue: number;
    percentChange: number;
    severity: "low" | "medium" | "high";
  }[];
}

// ============================================================================
// EXPLAINABILITY ARTIFACTS
// ============================================================================

/**
 * Explainability artifact for a single DD run
 */
export interface DDExplainability {
  jobId: string;
  entityName: string;
  timestamp: number;

  // Final decision
  finalTier: DDTier;
  finalRiskScore: number;
  wasEscalated: boolean;
  escalationReason?: string;

  // Top contributing signals
  topSignals: Array<{
    signal: DDRiskSignal;
    contributionToScore: number;  // How much this signal added
    categoryWeight: number;
    severityMultiplier: number;
    explanation: string;
  }>;

  // Evidence trail
  evidenceArtifacts: Array<{
    artifactId: string;
    type: "registry_match" | "search_result" | "api_response" | "document";
    summary: string;
    url?: string;
    confidence: number;
  }>;

  // Why weights fired
  weightExplanation: {
    baseScore: number;
    categoryContributions: Record<DDRiskCategory, number>;
    escalationTriggersApplied: string[];
    tierOverrideApplied: boolean;
    tierOverrideReason?: string;
  };

  // Human-readable summary
  narrativeSummary: string;
}

// ============================================================================
// CALIBRATION FUNCTIONS
// ============================================================================

/**
 * Calculate calibration metrics from outcome records
 */
export function calculateCalibration(
  outcomes: DDOutcomeRecord[],
  riskThreshold: number = 50
): CategoryCalibration[] {
  const categories: DDRiskCategory[] = [
    "identity_provenance",
    "claims_verification",
    "transaction_integrity",
    "sector_regulatory",
    "entity_authenticity",
    "document_consistency",
  ];

  return categories.map(category => {
    // Filter outcomes that had signals in this category
    const categoryOutcomes = outcomes.filter(o =>
      o.signals.some(s => s.category === category)
    );

    if (categoryOutcomes.length === 0) {
      return {
        category,
        totalSamples: 0,
        truePositives: 0,
        falsePositives: 0,
        trueNegatives: 0,
        falseNegatives: 0,
        precision: 0,
        recall: 0,
        f1Score: 0,
        brierScore: 0,
        calibrationError: 0,
        recommendedWeightAdjustment: 1.0,
        driftWarning: false,
      };
    }

    // Calculate confusion matrix
    let tp = 0, fp = 0, tn = 0, fn = 0;

    for (const outcome of categoryOutcomes) {
      const categoryScore = outcome.signals
        .filter(s => s.category === category)
        .reduce((sum, s) => sum + severityToScore(s.severity), 0);

      const predictedHigh = categoryScore >= riskThreshold / categories.length;
      const actualBad = outcome.outcome === "confirmed_fraud" ||
                        outcome.outcome === "confirmed_misrep";

      if (predictedHigh && actualBad) tp++;
      else if (predictedHigh && !actualBad) fp++;
      else if (!predictedHigh && !actualBad) tn++;
      else fn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1Score = precision + recall > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 0;

    // Calculate Brier score (calibration quality)
    let brierSum = 0;
    for (const outcome of categoryOutcomes) {
      const predictedProb = outcome.riskScore / 100;
      const actualOutcome = outcome.outcome === "confirmed_fraud" ||
                           outcome.outcome === "confirmed_misrep" ? 1 : 0;
      brierSum += Math.pow(predictedProb - actualOutcome, 2);
    }
    const brierScore = brierSum / categoryOutcomes.length;

    // Recommend weight adjustment
    let recommendedWeightAdjustment = 1.0;
    if (precision < 0.5 && recall > 0.7) {
      // Too many false positives, reduce weight
      recommendedWeightAdjustment = 0.8;
    } else if (precision > 0.7 && recall < 0.5) {
      // Missing too many, increase weight
      recommendedWeightAdjustment = 1.2;
    }

    return {
      category,
      totalSamples: categoryOutcomes.length,
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
      precision,
      recall,
      f1Score,
      brierScore,
      calibrationError: Math.abs(precision - recall),
      recommendedWeightAdjustment,
      driftWarning: f1Score < 0.5,
    };
  });
}

/**
 * Generate tier accuracy metrics
 */
export function calculateTierAccuracy(
  outcomes: DDOutcomeRecord[]
): CalibrationReport["tierAccuracy"] {
  const tiers: DDTier[] = ["FAST_VERIFY", "LIGHT_DD", "STANDARD_DD", "FULL_PLAYBOOK"];

  const result: CalibrationReport["tierAccuracy"] = {} as any;

  for (const tier of tiers) {
    const tierOutcomes = outcomes.filter(o => o.tier === tier);

    let correctEscalations = 0;
    let missedEscalations = 0;
    let overEscalations = 0;

    for (const outcome of tierOutcomes) {
      const shouldHaveEscalated = outcome.outcome === "confirmed_fraud" ||
                                   outcome.outcome === "confirmed_misrep";
      const didEscalate = tier === "FULL_PLAYBOOK" ||
                          (tier === "STANDARD_DD" && outcome.escalationTriggers.length > 0);

      if (shouldHaveEscalated && didEscalate) correctEscalations++;
      else if (shouldHaveEscalated && !didEscalate) missedEscalations++;
      else if (!shouldHaveEscalated && didEscalate) overEscalations++;
    }

    result[tier] = {
      total: tierOutcomes.length,
      correctEscalations,
      missedEscalations,
      overEscalations,
      accuracy: tierOutcomes.length > 0
        ? (tierOutcomes.length - missedEscalations - overEscalations) / tierOutcomes.length
        : 0,
    };
  }

  return result;
}

/**
 * Detect drift between two calibration reports
 */
export function detectDrift(
  current: CategoryCalibration[],
  previous: CategoryCalibration[],
  driftThreshold: number = 0.15
): CalibrationReport["driftAlerts"] {
  const alerts: CalibrationReport["driftAlerts"] = [];

  for (const currCat of current) {
    const prevCat = previous.find(p => p.category === currCat.category);
    if (!prevCat || prevCat.totalSamples < 10) continue;

    // Check precision drift
    if (Math.abs(currCat.precision - prevCat.precision) > driftThreshold) {
      const percentChange = ((currCat.precision - prevCat.precision) / prevCat.precision) * 100;
      alerts.push({
        category: currCat.category,
        metric: "precision",
        previousValue: prevCat.precision,
        currentValue: currCat.precision,
        percentChange,
        severity: Math.abs(percentChange) > 30 ? "high" : Math.abs(percentChange) > 20 ? "medium" : "low",
      });
    }

    // Check recall drift
    if (Math.abs(currCat.recall - prevCat.recall) > driftThreshold) {
      const percentChange = ((currCat.recall - prevCat.recall) / prevCat.recall) * 100;
      alerts.push({
        category: currCat.category,
        metric: "recall",
        previousValue: prevCat.recall,
        currentValue: currCat.recall,
        percentChange,
        severity: Math.abs(percentChange) > 30 ? "high" : Math.abs(percentChange) > 20 ? "medium" : "low",
      });
    }
  }

  return alerts;
}

/**
 * Generate explainability artifact for a DD run
 */
export function generateExplainability(
  jobId: string,
  entityName: string,
  riskScore: number,
  tier: DDTier,
  signals: DDRiskSignal[],
  escalationTriggers: string[],
  wasOverridden: boolean,
  fundingBasedTier?: DDTier
): DDExplainability {
  // Calculate contribution of each signal
  const topSignals = signals
    .map(signal => {
      const categoryWeights: Record<DDRiskCategory, number> = {
        identity_provenance: 15,
        claims_verification: 12,
        transaction_integrity: 18,
        sector_regulatory: 10,
        entity_authenticity: 14,
        document_consistency: 8,
      };

      const severityMultiplier = severityToScore(signal.severity);
      const contributionToScore = categoryWeights[signal.category] * severityMultiplier;

      return {
        signal,
        contributionToScore,
        categoryWeight: categoryWeights[signal.category],
        severityMultiplier,
        explanation: `${signal.category} [${signal.severity}]: ${signal.signal}`,
      };
    })
    .sort((a, b) => b.contributionToScore - a.contributionToScore)
    .slice(0, 5);

  // Calculate category contributions
  const categoryContributions: Record<DDRiskCategory, number> = {
    identity_provenance: 0,
    claims_verification: 0,
    transaction_integrity: 0,
    sector_regulatory: 0,
    entity_authenticity: 0,
    document_consistency: 0,
  };

  for (const signal of topSignals) {
    categoryContributions[signal.signal.category] += signal.contributionToScore;
  }

  // Generate narrative
  const topCategories = Object.entries(categoryContributions)
    .filter(([_, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);

  let narrative = `Risk score ${riskScore}/100 driven primarily by ${topCategories.join(", ")}.`;

  if (escalationTriggers.length > 0) {
    narrative += ` ESCALATION TRIGGERED: ${escalationTriggers.join("; ")}.`;
  }

  if (wasOverridden) {
    narrative += ` Tier was escalated from ${fundingBasedTier} to ${tier} due to risk signals.`;
  }

  return {
    jobId,
    entityName,
    timestamp: Date.now(),
    finalTier: tier,
    finalRiskScore: riskScore,
    wasEscalated: escalationTriggers.length > 0 || wasOverridden,
    escalationReason: escalationTriggers.length > 0
      ? escalationTriggers.join("; ")
      : wasOverridden
      ? `Risk score ${riskScore} exceeded threshold for ${fundingBasedTier}`
      : undefined,
    topSignals,
    evidenceArtifacts: [], // Would be populated from micro-branch results
    weightExplanation: {
      baseScore: 0,
      categoryContributions,
      escalationTriggersApplied: escalationTriggers,
      tierOverrideApplied: wasOverridden,
      tierOverrideReason: wasOverridden
        ? `Risk-based tier (${tier}) higher than funding-based (${fundingBasedTier})`
        : undefined,
    },
    narrativeSummary: narrative,
  };
}

// ============================================================================
// UTILITIES
// ============================================================================

function severityToScore(severity: DDRiskSignal["severity"]): number {
  switch (severity) {
    case "critical": return 8;
    case "high": return 4;
    case "medium": return 2;
    case "low": return 1;
    default: return 1;
  }
}

/**
 * Generate threshold recommendations based on calibration
 */
export function generateThresholdRecommendations(
  tierAccuracy: CalibrationReport["tierAccuracy"],
  currentThresholds: Record<DDTier, { min: number }>
): CalibrationReport["thresholdRecommendations"] {
  const recommendations: CalibrationReport["thresholdRecommendations"] = [];

  for (const [tier, metrics] of Object.entries(tierAccuracy) as [DDTier, any][]) {
    if (metrics.total < 10) continue;

    const missRate = metrics.missedEscalations / metrics.total;
    const overRate = metrics.overEscalations / metrics.total;

    if (missRate > 0.2) {
      // Missing too many - lower the threshold
      recommendations.push({
        tier,
        currentMin: currentThresholds[tier]?.min ?? 0,
        recommendedMin: Math.max(0, (currentThresholds[tier]?.min ?? 50) - 10),
        reason: `Missing ${(missRate * 100).toFixed(0)}% of escalations - lower threshold to catch more`,
      });
    } else if (overRate > 0.3) {
      // Over-escalating - raise the threshold
      recommendations.push({
        tier,
        currentMin: currentThresholds[tier]?.min ?? 0,
        recommendedMin: Math.min(100, (currentThresholds[tier]?.min ?? 50) + 10),
        reason: `Over-escalating ${(overRate * 100).toFixed(0)}% - raise threshold to reduce noise`,
      });
    }
  }

  return recommendations;
}
