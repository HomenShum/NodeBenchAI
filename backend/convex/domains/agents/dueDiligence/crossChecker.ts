/**
 * crossChecker.ts
 *
 * Cross-check module for contradiction detection and resolution.
 * Compares findings across branches, identifies conflicts, and attempts resolution
 * using weighted evidence and source reliability.
 */

import {
  BranchType,
  Contradiction,
  CrossCheckResult,
  DDSource,
  SourceReliability,
  BranchFindings,
} from "./types";

// ============================================================================
// Types
// ============================================================================

interface BranchResult {
  branchType: BranchType;
  findings: any;
  confidence?: number;
  sources: DDSource[];
}

interface ResolutionResult {
  resolution: "resolved_to_a" | "resolved_to_b" | "unresolved" | "both_valid";
  reason: string;
  resolvedValue?: string;
}

// ============================================================================
// Main Cross-Check Function
// ============================================================================

/**
 * Cross-check findings across all branches to identify contradictions
 */
export function crossCheckAllBranches(
  branchResults: BranchResult[]
): {
  contradictions: Contradiction[];
  crossChecks: CrossCheckResult[];
  overallAgreement: number;
} {
  const contradictions: Contradiction[] = [];
  const crossChecks: CrossCheckResult[] = [];

  // Get successful branches
  const successfulBranches = branchResults.filter(r => r.findings !== null);

  // Cross-check each pair of branches
  for (let i = 0; i < successfulBranches.length; i++) {
    for (let j = i + 1; j < successfulBranches.length; j++) {
      const branchA = successfulBranches[i];
      const branchB = successfulBranches[j];

      const result = crossCheckBranchPair(branchA, branchB);
      crossChecks.push(result);

      // Add contradictions to the list
      for (const disagreement of result.disagreements) {
        if (!contradictions.some(c => c.field === disagreement.field)) {
          contradictions.push(disagreement);
        }
      }
    }
  }

  // Calculate overall agreement
  const totalComparisons = crossChecks.length;
  const totalAgreement = crossChecks.reduce((sum, c) => sum + c.overallAgreement, 0);
  const overallAgreement = totalComparisons > 0 ? totalAgreement / totalComparisons : 0;

  return { contradictions, crossChecks, overallAgreement };
}

// ============================================================================
// Branch Pair Cross-Check
// ============================================================================

/**
 * Cross-check a pair of branches for agreements and disagreements
 */
function crossCheckBranchPair(
  branchA: BranchResult,
  branchB: BranchResult
): CrossCheckResult {
  const agreements: string[] = [];
  const disagreements: Contradiction[] = [];

  // Define fields to check based on branch types
  const fieldsToCheck = getFieldsToCheck(branchA.branchType, branchB.branchType);

  for (const field of fieldsToCheck) {
    const valueA = getFieldValue(branchA.findings, field);
    const valueB = getFieldValue(branchB.findings, field);

    if (valueA !== undefined && valueB !== undefined) {
      const comparison = compareValues(field, valueA, valueB);

      if (comparison.matches) {
        agreements.push(`${field}: Values agree`);
      } else {
        // Attempt resolution
        const resolution = attemptResolution(
          field,
          valueA,
          valueB,
          branchA,
          branchB
        );

        disagreements.push({
          field,
          sourceA: branchA.branchType,
          valueA: stringifyValue(valueA),
          sourceB: branchB.branchType,
          valueB: stringifyValue(valueB),
          resolution: resolution.resolution,
          resolutionReason: resolution.reason,
          confidenceA: branchA.confidence,
          confidenceB: branchB.confidence,
        });
      }
    }
  }

  // Calculate agreement score
  const totalChecks = agreements.length + disagreements.length;
  const overallAgreement = totalChecks > 0
    ? agreements.length / totalChecks
    : 1; // No overlapping fields = no disagreement

  return {
    branchA: branchA.branchType,
    branchB: branchB.branchType,
    agreements,
    disagreements,
    overallAgreement,
  };
}

// ============================================================================
// Field Comparison
// ============================================================================

/**
 * Get fields that can be cross-checked between two branch types
 */
function getFieldsToCheck(typeA: BranchType, typeB: BranchType): string[] {
  const commonFields = [
    "foundedYear",
    "employeeCount",
    "hqLocation",
    "sectors",
    "totalRaised",
    "fundingStage",
    "teamSize",
  ];

  // Branch-specific overlapping fields
  const branchFieldOverlaps: Record<string, Record<string, string[]>> = {
    company_profile: {
      team_founders: ["foundedYear", "employeeCount"],
      financial_deep: ["totalRaised", "fundingStage"],
      market_competitive: ["sectors"],
    },
    team_founders: {
      company_profile: ["foundedYear", "employeeCount"],
      network_mapping: ["teamSize"],
    },
    financial_deep: {
      company_profile: ["totalRaised", "fundingStage"],
      market_competitive: ["totalRaised"],
    },
  };

  // Find overlapping fields for this pair
  const fieldsFromA = branchFieldOverlaps[typeA]?.[typeB] ?? [];
  const fieldsFromB = branchFieldOverlaps[typeB]?.[typeA] ?? [];

  return [...new Set([...fieldsFromA, ...fieldsFromB, ...commonFields])];
}

/**
 * Get a field value from findings object (supports nested paths)
 */
function getFieldValue(findings: any, field: string): any {
  if (!findings) return undefined;

  // Direct field access
  if (findings[field] !== undefined) {
    return findings[field];
  }

  // Try nested paths
  const paths: Record<string, string[]> = {
    totalRaised: ["totalRaised", "fundingHistory.totalRaised"],
    fundingStage: ["stage", "fundingStage"],
    teamSize: ["teamSize", "founders.length"],
  };

  const possiblePaths = paths[field] ?? [field];

  for (const path of possiblePaths) {
    const parts = path.split(".");
    let value = findings;

    for (const part of parts) {
      if (value === undefined || value === null) break;

      if (part === "length" && Array.isArray(value)) {
        value = value.length;
      } else {
        value = value[part];
      }
    }

    if (value !== undefined) return value;
  }

  return undefined;
}

/**
 * Compare two values for a given field
 */
function compareValues(
  field: string,
  valueA: any,
  valueB: any
): { matches: boolean; difference?: string } {
  // Numeric comparison with tolerance
  if (typeof valueA === "number" && typeof valueB === "number") {
    const tolerance = getNumericTolerance(field);
    const diff = Math.abs(valueA - valueB);
    const avg = (valueA + valueB) / 2;
    const percentDiff = avg > 0 ? diff / avg : 0;

    return {
      matches: percentDiff <= tolerance,
      difference: percentDiff > tolerance ? `${(percentDiff * 100).toFixed(1)}% difference` : undefined,
    };
  }

  // String comparison
  if (typeof valueA === "string" && typeof valueB === "string") {
    const normalizedA = normalizeString(valueA);
    const normalizedB = normalizeString(valueB);

    return {
      matches: normalizedA === normalizedB || isSemanticMatch(field, normalizedA, normalizedB),
    };
  }

  // Array comparison (e.g., sectors)
  if (Array.isArray(valueA) && Array.isArray(valueB)) {
    const setA = new Set(valueA.map(normalizeString));
    const setB = new Set(valueB.map(normalizeString));
    const intersection = [...setA].filter(x => setB.has(x));
    const overlap = intersection.length / Math.max(setA.size, setB.size);

    return {
      matches: overlap >= 0.5, // At least 50% overlap
    };
  }

  // Object comparison (e.g., funding amounts)
  if (typeof valueA === "object" && typeof valueB === "object") {
    return compareFundingAmounts(valueA, valueB);
  }

  return { matches: false };
}

/**
 * Get tolerance for numeric field comparison
 */
function getNumericTolerance(field: string): number {
  const tolerances: Record<string, number> = {
    foundedYear: 0.01, // Year should match exactly
    employeeCount: 0.3, // 30% tolerance (can vary by source)
    teamSize: 0.2,
    totalRaised: 0.15, // 15% tolerance
  };

  return tolerances[field] ?? 0.1;
}

/**
 * Normalize string for comparison
 */
function normalizeString(s: any): string {
  if (typeof s !== "string") return String(s);
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Check for semantic matches (e.g., "San Francisco" vs "SF")
 */
function isSemanticMatch(field: string, valueA: string, valueB: string): boolean {
  const synonyms: Record<string, string[][]> = {
    hqLocation: [
      ["san francisco", "sf", "san francisco, ca"],
      ["new york", "ny", "nyc", "new york city"],
      ["los angeles", "la", "los angeles, ca"],
      ["boston", "boston, ma"],
      ["seattle", "seattle, wa"],
    ],
    sectors: [
      ["ai", "artificial intelligence", "machine learning", "ai/ml"],
      ["fintech", "financial technology"],
      ["biotech", "biotechnology"],
      ["healthtech", "health technology", "digital health"],
    ],
  };

  const fieldSynonyms = synonyms[field];
  if (!fieldSynonyms) return false;

  for (const group of fieldSynonyms) {
    const groupLower = group.map(s => s.toLowerCase());
    if (groupLower.includes(valueA) && groupLower.includes(valueB)) {
      return true;
    }
  }

  return false;
}

/**
 * Compare funding amounts with currency normalization
 */
function compareFundingAmounts(
  amountA: any,
  amountB: any
): { matches: boolean } {
  // Convert to comparable numbers (in millions)
  const getMillions = (amt: any): number | undefined => {
    if (!amt || typeof amt !== "object") return undefined;

    const value = amt.amount ?? amt.value;
    const unit = amt.unit ?? "M";

    if (typeof value !== "number") return undefined;

    switch (unit.toUpperCase()) {
      case "B": return value * 1000;
      case "M": return value;
      case "K": return value / 1000;
      default: return value;
    }
  };

  const millionsA = getMillions(amountA);
  const millionsB = getMillions(amountB);

  if (millionsA === undefined || millionsB === undefined) {
    return { matches: false };
  }

  const diff = Math.abs(millionsA - millionsB);
  const avg = (millionsA + millionsB) / 2;
  const percentDiff = avg > 0 ? diff / avg : 0;

  return { matches: percentDiff <= 0.15 };
}

// ============================================================================
// Contradiction Resolution
// ============================================================================

/**
 * Attempt to resolve a contradiction using weighted evidence
 */
function attemptResolution(
  field: string,
  valueA: any,
  valueB: any,
  branchA: BranchResult,
  branchB: BranchResult
): ResolutionResult {
  // Get source reliability scores
  const reliabilityA = getSourceReliabilityScore(branchA);
  const reliabilityB = getSourceReliabilityScore(branchB);

  // Get branch authority for this field
  const authorityA = getBranchFieldAuthority(branchA.branchType, field);
  const authorityB = getBranchFieldAuthority(branchB.branchType, field);

  // Combined score
  const scoreA = reliabilityA * authorityA * (branchA.confidence ?? 0.5);
  const scoreB = reliabilityB * authorityB * (branchB.confidence ?? 0.5);

  // Significant difference threshold
  const scoreDiff = Math.abs(scoreA - scoreB);

  if (scoreDiff > 0.3) {
    // Clear winner
    if (scoreA > scoreB) {
      return {
        resolution: "resolved_to_a",
        reason: `Higher confidence from ${branchA.branchType} (${(scoreA * 100).toFixed(0)}% vs ${(scoreB * 100).toFixed(0)}%)`,
        resolvedValue: stringifyValue(valueA),
      };
    } else {
      return {
        resolution: "resolved_to_b",
        reason: `Higher confidence from ${branchB.branchType} (${(scoreB * 100).toFixed(0)}% vs ${(scoreA * 100).toFixed(0)}%)`,
        resolvedValue: stringifyValue(valueB),
      };
    }
  }

  // Check if both could be valid (e.g., employee counts from different dates)
  if (couldBothBeValid(field, valueA, valueB)) {
    return {
      resolution: "both_valid",
      reason: `Both values may be valid at different points in time (${field})`,
    };
  }

  // Unable to resolve
  return {
    resolution: "unresolved",
    reason: `Unable to determine correct value with available evidence`,
  };
}

/**
 * Get source reliability score for a branch
 */
function getSourceReliabilityScore(branch: BranchResult): number {
  const reliabilityWeights: Record<SourceReliability, number> = {
    authoritative: 1.0,
    reliable: 0.8,
    secondary: 0.5,
    inferred: 0.3,
  };

  const sources = branch.sources ?? [];

  if (sources.length === 0) return 0.3;

  // Weighted average based on source reliability
  const totalWeight = sources.reduce((sum, s) => {
    return sum + (reliabilityWeights[s.reliability] ?? 0.5);
  }, 0);

  return totalWeight / sources.length;
}

/**
 * Get branch authority for a specific field
 * (Some branches are more authoritative for certain fields)
 */
function getBranchFieldAuthority(branchType: BranchType, field: string): number {
  const authorityMap: Record<BranchType, Record<string, number>> = {
    company_profile: {
      foundedYear: 0.8,
      hqLocation: 0.9,
      employeeCount: 0.7,
      sectors: 0.8,
    },
    team_founders: {
      foundedYear: 0.9, // Founders are authoritative on this
      teamSize: 0.95,
      employeeCount: 0.6,
    },
    market_competitive: {
      sectors: 0.9,
      competitors: 0.95,
    },
    financial_deep: {
      totalRaised: 0.95,
      fundingStage: 0.95,
    },
    technical_dd: {
      techStack: 0.95,
    },
    ip_patents: {
      patents: 0.95,
    },
    regulatory: {
      regulatoryStatus: 0.95,
    },
    network_mapping: {
      investorNetwork: 0.9,
    },
  };

  return authorityMap[branchType]?.[field] ?? 0.5;
}

/**
 * Check if both values could be valid (temporal or contextual differences)
 */
function couldBothBeValid(field: string, valueA: any, valueB: any): boolean {
  const temporalFields = ["employeeCount", "teamSize", "totalRaised"];

  if (temporalFields.includes(field)) {
    // Employee counts, funding totals can change over time
    return true;
  }

  return false;
}

/**
 * Convert value to string for storage
 */
function stringifyValue(value: any): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object" && value !== null) {
    if (value.amount !== undefined && value.unit !== undefined) {
      return `${value.amount}${value.unit}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

// ============================================================================
// Exports
// ============================================================================

export {
  crossCheckBranchPair,
  attemptResolution,
  getSourceReliabilityScore,
};
