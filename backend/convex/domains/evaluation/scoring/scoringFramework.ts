/**
 * Scoring Framework
 *
 * Universal 100-point normalized scoring system for persona evaluations.
 * Supports weighted categories, critical category enforcement, and pass thresholds.
 */

import type { PersonaId } from "../../../config/autonomousConfig";
import type { CategoryScore, CategoryFinding, PersonaEvalResult } from "../personas/types";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scoring category configuration
 */
export interface ScoringCategory {
  name: string;
  weight: number; // Percentage (0-100), all weights should sum to 100
  isCritical: boolean; // If true, must pass regardless of total score
  criticalThreshold?: number; // Score below this = critical failure (default: 50)
  subCategories?: SubCategory[];
}

/**
 * Sub-category for granular scoring
 */
export interface SubCategory {
  name: string;
  points: number;
  evaluationType: "boolean" | "numeric" | "llm_judge" | "threshold";
  groundTruthKey?: string;
  thresholdMin?: number;
  thresholdMax?: number;
}

/**
 * Persona scoring configuration
 */
export interface PersonaScoringConfig {
  personaId: PersonaId;
  categories: ScoringCategory[];
  passingThreshold: number; // 0-100, normalized score needed to pass
  maxScore: number; // Total raw points possible (typically 100)
}

/**
 * Raw score input for evaluation
 */
export interface RawScoreInput {
  category: string;
  rawScore: number;
  maxPoints: number;
  findings: CategoryFinding[];
}

/**
 * Normalized scoring result
 */
export interface NormalizedScoringResult {
  totalScore: number; // 0-100 normalized
  categoryScores: CategoryScore[];
  passed: boolean;
  criticalFailures: string[];
  passingThreshold: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCORING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize raw scores to 100-point scale with weighted categories
 */
export function normalizeScores(
  rawScores: RawScoreInput[],
  config: PersonaScoringConfig
): NormalizedScoringResult {
  const categoryScores: CategoryScore[] = [];
  const criticalFailures: string[] = [];
  let totalWeightedScore = 0;

  for (const categoryConfig of config.categories) {
    const rawScore = rawScores.find((s) => s.category === categoryConfig.name);

    if (!rawScore) {
      // Category not scored - treat as 0
      const categoryScore: CategoryScore = {
        category: categoryConfig.name,
        weight: categoryConfig.weight,
        rawScore: 0,
        maxPoints: 100, // Assume 100 if not specified
        normalizedScore: 0,
        isCritical: categoryConfig.isCritical,
        passed: false,
        findings: [],
      };
      categoryScores.push(categoryScore);

      if (categoryConfig.isCritical) {
        criticalFailures.push(`Missing critical category: ${categoryConfig.name}`);
      }
      continue;
    }

    // Calculate normalized score for this category (0-100)
    const normalizedCategoryScore =
      rawScore.maxPoints > 0 ? (rawScore.rawScore / rawScore.maxPoints) * 100 : 0;

    // Check critical threshold
    const criticalThreshold = categoryConfig.criticalThreshold ?? 50;
    const categoryPassed = normalizedCategoryScore >= criticalThreshold;

    if (categoryConfig.isCritical && !categoryPassed) {
      criticalFailures.push(
        `Critical category failed: ${categoryConfig.name} (${normalizedCategoryScore.toFixed(0)}% < ${criticalThreshold}%)`
      );
    }

    // Add weighted contribution to total score
    const weightedContribution = (normalizedCategoryScore * categoryConfig.weight) / 100;
    totalWeightedScore += weightedContribution;

    const categoryScore: CategoryScore = {
      category: categoryConfig.name,
      weight: categoryConfig.weight,
      rawScore: rawScore.rawScore,
      maxPoints: rawScore.maxPoints,
      normalizedScore: Math.round(normalizedCategoryScore),
      isCritical: categoryConfig.isCritical,
      passed: categoryPassed,
      findings: rawScore.findings,
    };

    categoryScores.push(categoryScore);
  }

  // Round total score
  const totalScore = Math.round(totalWeightedScore);

  // Determine pass/fail
  const passed = totalScore >= config.passingThreshold && criticalFailures.length === 0;

  return {
    totalScore,
    categoryScores,
    passed,
    criticalFailures,
    passingThreshold: config.passingThreshold,
  };
}

/**
 * Convert a Map of category scores (0-1 scale) to RawScoreInput array
 * Use this when you have simple percentage scores per category
 */
export function mapToRawScores(
  scores: Map<string, number>,
  config: PersonaScoringConfig
): RawScoreInput[] {
  const rawScores: RawScoreInput[] = [];

  for (const category of config.categories) {
    const score = scores.get(category.name) ?? 0;
    // Convert 0-1 score to raw points (assume 100 max per category)
    const maxPoints = 100;
    const rawScore = Math.round(score * maxPoints);

    rawScores.push({
      category: category.name,
      rawScore,
      maxPoints,
      findings: [{
        field: category.name,
        expected: `>= ${category.criticalThreshold ?? 50}%`,
        actual: `${Math.round(score * 100)}%`,
        match: score >= ((category.criticalThreshold ?? 50) / 100),
      }],
    });
  }

  return rawScores;
}

/**
 * Calculate category score from boolean checks
 */
export function scoreBooleanChecks(
  checks: Array<{ name: string; passed: boolean; points: number; expected?: string; actual?: string }>
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  let rawScore = 0;
  let maxPoints = 0;
  const findings: CategoryFinding[] = [];

  for (const check of checks) {
    maxPoints += check.points;
    if (check.passed) {
      rawScore += check.points;
    }
    findings.push({
      field: check.name,
      expected: check.expected ?? "true",
      actual: check.actual ?? String(check.passed),
      match: check.passed,
    });
  }

  return { rawScore, maxPoints, findings };
}

/**
 * Calculate category score from threshold checks
 */
export function scoreThresholdChecks(
  checks: Array<{
    name: string;
    value: number;
    threshold: number;
    operator: "gte" | "lte" | "eq";
    points: number;
  }>
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  let rawScore = 0;
  let maxPoints = 0;
  const findings: CategoryFinding[] = [];

  for (const check of checks) {
    maxPoints += check.points;
    let passed = false;

    switch (check.operator) {
      case "gte":
        passed = check.value >= check.threshold;
        break;
      case "lte":
        passed = check.value <= check.threshold;
        break;
      case "eq":
        passed = check.value === check.threshold;
        break;
    }

    if (passed) {
      rawScore += check.points;
    }

    findings.push({
      field: check.name,
      expected: `${check.operator} ${check.threshold}`,
      actual: String(check.value),
      match: passed,
    });
  }

  return { rawScore, maxPoints, findings };
}

/**
 * Calculate category score from confidence checks
 */
export function scoreConfidenceChecks(
  checks: Array<{
    name: string;
    confidence: number;
    minConfidence: number;
    points: number;
    source?: string;
  }>
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  let rawScore = 0;
  let maxPoints = 0;
  const findings: CategoryFinding[] = [];

  for (const check of checks) {
    maxPoints += check.points;
    const passed = check.confidence >= check.minConfidence;

    if (passed) {
      // Scale points by confidence above threshold
      const bonusFactor = Math.min(1, (check.confidence - check.minConfidence) / (1 - check.minConfidence));
      rawScore += check.points * (0.7 + 0.3 * bonusFactor); // 70-100% of points based on confidence
    }

    findings.push({
      field: check.name,
      expected: `>= ${(check.minConfidence * 100).toFixed(0)}%`,
      actual: `${(check.confidence * 100).toFixed(0)}%`,
      match: passed,
      confidence: check.confidence,
      source: check.source,
    });
  }

  return { rawScore: Math.round(rawScore), maxPoints, findings };
}

/**
 * Build evaluation result from scoring
 */
export function buildEvalResult(
  personaId: PersonaId,
  caseName: string,
  scoringResult: NormalizedScoringResult,
  executionTimeMs: number,
  report: string,
  rawOutput: Record<string, unknown>
): PersonaEvalResult {
  // Calculate max score from category weights
  const maxScore = scoringResult.categoryScores.reduce((sum, c) => sum + c.maxPoints, 0);

  return {
    personaId,
    caseName,
    passed: scoringResult.passed,
    score: scoringResult.categoryScores.reduce((sum, c) => sum + c.rawScore, 0),
    maxScore,
    normalizedScore: scoringResult.totalScore,
    categoryScores: scoringResult.categoryScores,
    criticalFailures: scoringResult.criticalFailures,
    executionTimeMs,
    report,
    rawOutput,
  };
}

/**
 * Generate human-readable score report
 */
export function generateScoreReport(result: PersonaEvalResult): string {
  const lines: string[] = [];

  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(`PERSONA EVALUATION: ${result.personaId}`);
  lines.push(`Case: ${result.caseName}`);
  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(``);
  lines.push(`RESULT: ${result.passed ? "PASSED" : "FAILED"}`);
  lines.push(`Score: ${result.normalizedScore}/100 (${result.score}/${result.maxScore} raw)`);
  lines.push(``);
  lines.push(`CATEGORY BREAKDOWN:`);

  for (const category of result.categoryScores) {
    const status = category.passed ? "PASS" : "FAIL";
    const critical = category.isCritical ? " [CRITICAL]" : "";
    lines.push(
      `  ${category.category}: ${category.normalizedScore}% (${category.rawScore}/${category.maxPoints}) - ${status}${critical}`
    );

    for (const finding of category.findings) {
      const matchIcon = finding.match ? "OK" : "XX";
      lines.push(`    [${matchIcon}] ${finding.field}: expected ${finding.expected}, got ${finding.actual}`);
    }
  }

  if (result.criticalFailures.length > 0) {
    lines.push(``);
    lines.push(`CRITICAL FAILURES:`);
    for (const failure of result.criticalFailures) {
      lines.push(`  - ${failure}`);
    }
  }

  lines.push(``);
  lines.push(`Execution time: ${result.executionTimeMs}ms`);
  lines.push(`═══════════════════════════════════════════════════════════════`);

  return lines.join("\n");
}

/**
 * Aggregate multiple persona evaluation results
 */
export function aggregateResults(results: PersonaEvalResult[]): {
  totalScore: number;
  passRate: number;
  passedCount: number;
  failedCount: number;
  averageExecutionTimeMs: number;
  criticalFailureCount: number;
} {
  if (results.length === 0) {
    return {
      totalScore: 0,
      passRate: 0,
      passedCount: 0,
      failedCount: 0,
      averageExecutionTimeMs: 0,
      criticalFailureCount: 0,
    };
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;
  const totalScore = results.reduce((sum, r) => sum + r.normalizedScore, 0) / results.length;
  const averageExecutionTimeMs =
    results.reduce((sum, r) => sum + r.executionTimeMs, 0) / results.length;
  const criticalFailureCount = results.reduce((sum, r) => sum + r.criticalFailures.length, 0);

  return {
    totalScore: Math.round(totalScore),
    passRate: (passedCount / results.length) * 100,
    passedCount,
    failedCount,
    averageExecutionTimeMs: Math.round(averageExecutionTimeMs),
    criticalFailureCount,
  };
}
