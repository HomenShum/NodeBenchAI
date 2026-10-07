// convex/lib/memoryQuality.ts
// Boolean-based memory quality evaluation for GAM

import { QUALITY_THRESHOLDS } from "./memoryLimits";

/**
 * Memory quality is evaluated using boolean flags, not arbitrary scores.
 * Each criterion either PASSES or FAILS - no ambiguous numbers.
 */
export interface MemoryQualityFlags {
  /** Has at least minFactsForCoverage structured facts */
  hasSufficientFacts: boolean;
  
  /** Research is less than maxDaysForFresh old */
  hasRecentResearch: boolean;
  
  /** No unresolved conflicts */
  hasNoConflicts: boolean;
  
  /** Has at least minSourcesForVerified sources */
  hasVerifiedSources: boolean;
  
  /** All facts meet minimum confidence threshold */
  hasHighConfidenceFacts: boolean;
  
  /** Has at least one narrative (for standard+ depth) */
  hasNarratives: boolean;
  
  /** Has at least one heuristic (for deep depth) */
  hasHeuristics: boolean;
}

/**
 * Overall quality tier based on flag combination.
 * - excellent: All flags pass
 * - good: Core flags pass (facts, sources, no conflicts)
 * - fair: Has content but some issues
 * - poor: Missing basic requirements
 */
export type QualityTier = "excellent" | "good" | "fair" | "poor";

export interface MemoryQualityResult {
  flags: MemoryQualityFlags;
  tier: QualityTier;
  summary: string;
  passCount: number;
  totalChecks: number;
}

/**
 * Evaluate memory quality using boolean checks.
 * No arbitrary scoring - each check is PASS or FAIL.
 */
export function evaluateMemoryQuality(params: {
  factCount: number;
  daysSinceResearch: number;
  unresolvedConflictCount: number;
  sourceCount: number;
  factConfidences: boolean[];  // Array of pass/fail for each fact
  narrativeCount: number;
  heuristicCount: number;
}): MemoryQualityResult {
  const {
    factCount,
    daysSinceResearch,
    unresolvedConflictCount,
    sourceCount,
    factConfidences,
    narrativeCount,
    heuristicCount,
  } = params;

  // Evaluate each boolean flag
  const flags: MemoryQualityFlags = {
    hasSufficientFacts: factCount >= QUALITY_THRESHOLDS.minFactsForCoverage,
    hasRecentResearch: daysSinceResearch <= QUALITY_THRESHOLDS.maxDaysForFresh,
    hasNoConflicts: unresolvedConflictCount <= QUALITY_THRESHOLDS.maxUnresolvedConflicts,
    hasVerifiedSources: sourceCount >= QUALITY_THRESHOLDS.minSourcesForVerified,
    hasHighConfidenceFacts: factConfidences.length === 0 || factConfidences.every(c => c),
    hasNarratives: narrativeCount > 0,
    hasHeuristics: heuristicCount > 0,
  };

  // Count passes (excluding optional narrative/heuristic flags for tier calc)
  const coreFlags = [
    flags.hasSufficientFacts,
    flags.hasRecentResearch,
    flags.hasNoConflicts,
    flags.hasVerifiedSources,
    flags.hasHighConfidenceFacts,
  ];
  
  const passCount = coreFlags.filter(Boolean).length;
  const totalChecks = coreFlags.length;

  // Determine tier
  let tier: QualityTier;
  if (passCount === totalChecks) {
    tier = flags.hasNarratives ? "excellent" : "good";
  } else if (passCount >= 3) {
    tier = "good";
  } else if (passCount >= 2) {
    tier = "fair";
  } else {
    tier = "poor";
  }

  // Generate human-readable summary
  const issues: string[] = [];
  if (!flags.hasSufficientFacts) issues.push("needs more facts");
  if (!flags.hasRecentResearch) issues.push("stale");
  if (!flags.hasNoConflicts) issues.push("has conflicts");
  if (!flags.hasVerifiedSources) issues.push("needs sources");
  if (!flags.hasHighConfidenceFacts) issues.push("low confidence facts");

  const summary = issues.length === 0 
    ? "Memory quality is excellent"
    : `Quality issues: ${issues.join(", ")}`;

  return {
    flags,
    tier,
    summary,
    passCount,
    totalChecks,
  };
}

/**
 * Check if a single fact passes the confidence threshold.
 * This is the ONLY place we use a numeric threshold.
 */
export function isFactHighConfidence(confidence: number): boolean {
  return confidence >= QUALITY_THRESHOLDS.minFactConfidence;
}

/**
 * Determine if memory should be marked stale.
 */
export function shouldMarkStale(daysSinceResearch: number): boolean {
  return daysSinceResearch > QUALITY_THRESHOLDS.maxDaysForFresh;
}

/**
 * Determine if memory should be archived (soft delete).
 */
export function shouldArchive(
  daysSinceAccess: number,
  qualityTier: QualityTier
): boolean {
  // Archive if:
  // 1. Not accessed in 90+ days AND
  // 2. Quality is fair or poor
  return daysSinceAccess > 90 && (qualityTier === "fair" || qualityTier === "poor");
}

/**
 * Determine if memory should be hard deleted.
 */
export function shouldDelete(daysSinceAccess: number): boolean {
  return daysSinceAccess > 365;
}
