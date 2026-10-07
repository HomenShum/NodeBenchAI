/**
 * Contradiction Detector - Multi-Source Fact Verification
 * Deep Agents 3.0 - Identifies and resolves conflicting information
 *
 * Features:
 * - Fact-level contradiction detection
 * - Source credibility weighting
 * - Temporal conflict resolution
 * - Automatic resolution suggestions
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { QUALITY_CONFIG } from "../../../config/autonomousConfig";
import type { Doc, Id } from "../../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export interface ContradictionCandidate {
  factA: {
    content: string;
    source: string;
    timestamp: number;
    confidence: number;
  };
  factB: {
    content: string;
    source: string;
    timestamp: number;
    confidence: number;
  };
  field: string;
  conflictType: "value" | "date" | "status" | "attribution";
  severity: "low" | "medium" | "high" | "critical";
}

export interface ResolutionSuggestion {
  strategy: "prefer_recent" | "prefer_credible" | "prefer_primary" | "manual_review" | "merge";
  confidence: number;
  suggestedValue: string;
  reasoning: string;
}

export interface ContradictionAnalysis {
  entityId: string;
  contradictions: ContradictionCandidate[];
  resolutions: ResolutionSuggestion[];
  overallIntegrity: number;
  requiresManualReview: boolean;
}

/* ================================================================== */
/* SOURCE CREDIBILITY                                                  */
/* ================================================================== */

const SOURCE_CREDIBILITY: Record<string, number> = {
  // Primary sources (highest credibility)
  "sec.gov": 0.95,
  "crunchbase.com": 0.90,
  "linkedin.com": 0.85,
  "github.com": 0.85,
  "company_website": 0.80,

  // News sources (high credibility)
  "techcrunch.com": 0.80,
  "reuters.com": 0.85,
  "bloomberg.com": 0.85,
  "wsj.com": 0.85,
  "nytimes.com": 0.80,

  // Secondary sources (medium credibility)
  "twitter.com": 0.60,
  "x.com": 0.60,
  "reddit.com": 0.50,
  "hackernews": 0.65,

  // Default for unknown sources
  default: 0.50,
};

function getSourceCredibility(source: string): number {
  const normalizedSource = source.toLowerCase();

  for (const [key, value] of Object.entries(SOURCE_CREDIBILITY)) {
    if (normalizedSource.includes(key)) {
      return value;
    }
  }

  return SOURCE_CREDIBILITY.default;
}

/* ================================================================== */
/* CONTRADICTION DETECTION                                             */
/* ================================================================== */

/**
 * Detect potential contradictions between facts
 */
function detectContradiction(
  factA: { content: string; field: string; source: string; timestamp: number },
  factB: { content: string; field: string; source: string; timestamp: number }
): ContradictionCandidate | null {
  // Only compare facts about the same field
  if (factA.field !== factB.field) {
    return null;
  }

  const contentA = factA.content.toLowerCase().trim();
  const contentB = factB.content.toLowerCase().trim();

  // Same content = no contradiction
  if (contentA === contentB) {
    return null;
  }

  // Determine conflict type
  let conflictType: ContradictionCandidate["conflictType"] = "value";

  // Date conflicts
  const datePatternA = /\b\d{4}[-/]\d{2}[-/]\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}\b/i;
  if (datePatternA.test(contentA) && datePatternA.test(contentB)) {
    conflictType = "date";
  }

  // Status conflicts
  const statusWords = ["active", "inactive", "acquired", "closed", "operating", "defunct", "public", "private"];
  const hasStatusA = statusWords.some(s => contentA.includes(s));
  const hasStatusB = statusWords.some(s => contentB.includes(s));
  if (hasStatusA && hasStatusB) {
    conflictType = "status";
  }

  // Calculate severity based on field importance
  const criticalFields = ["funding", "valuation", "ceo", "status", "acquisition"];
  const highFields = ["revenue", "employees", "hq", "founded"];

  let severity: ContradictionCandidate["severity"] = "low";
  if (criticalFields.some(f => factA.field.toLowerCase().includes(f))) {
    severity = "critical";
  } else if (highFields.some(f => factA.field.toLowerCase().includes(f))) {
    severity = "high";
  } else if (Math.abs(contentA.length - contentB.length) > 50) {
    severity = "medium";
  }

  return {
    factA: {
      content: factA.content,
      source: factA.source,
      timestamp: factA.timestamp,
      confidence: getSourceCredibility(factA.source),
    },
    factB: {
      content: factB.content,
      source: factB.source,
      timestamp: factB.timestamp,
      confidence: getSourceCredibility(factB.source),
    },
    field: factA.field,
    conflictType,
    severity,
  };
}

/**
 * Suggest resolution for a contradiction
 */
function suggestResolution(contradiction: ContradictionCandidate): ResolutionSuggestion {
  const { factA, factB, conflictType, severity } = contradiction;

  // For date conflicts, prefer more recent source
  if (conflictType === "date") {
    const preferA = factA.timestamp > factB.timestamp;
    return {
      strategy: "prefer_recent",
      confidence: 0.7,
      suggestedValue: preferA ? factA.content : factB.content,
      reasoning: `Preferring more recent source (${new Date(preferA ? factA.timestamp : factB.timestamp).toISOString()})`,
    };
  }

  // For status conflicts, prefer primary/credible sources
  if (conflictType === "status") {
    if (factA.confidence > factB.confidence + 0.1) {
      return {
        strategy: "prefer_credible",
        confidence: factA.confidence,
        suggestedValue: factA.content,
        reasoning: `Source ${factA.source} has higher credibility (${factA.confidence.toFixed(2)} vs ${factB.confidence.toFixed(2)})`,
      };
    } else if (factB.confidence > factA.confidence + 0.1) {
      return {
        strategy: "prefer_credible",
        confidence: factB.confidence,
        suggestedValue: factB.content,
        reasoning: `Source ${factB.source} has higher credibility (${factB.confidence.toFixed(2)} vs ${factA.confidence.toFixed(2)})`,
      };
    }
  }

  // For critical severity, always require manual review
  if (severity === "critical") {
    return {
      strategy: "manual_review",
      confidence: 0.3,
      suggestedValue: "",
      reasoning: "Critical field conflict requires human verification",
    };
  }

  // Default: prefer more credible source, or if equal, more recent
  if (Math.abs(factA.confidence - factB.confidence) > 0.1) {
    const preferA = factA.confidence > factB.confidence;
    return {
      strategy: "prefer_credible",
      confidence: Math.max(factA.confidence, factB.confidence),
      suggestedValue: preferA ? factA.content : factB.content,
      reasoning: `Preferring source with higher credibility score`,
    };
  }

  // Equal credibility: prefer recent
  const preferA = factA.timestamp > factB.timestamp;
  return {
    strategy: "prefer_recent",
    confidence: 0.6,
    suggestedValue: preferA ? factA.content : factB.content,
    reasoning: "Sources have similar credibility; preferring more recent",
  };
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get existing contradictions for an entity
 */
export const getEntityContradictions = internalQuery({
  args: { entityId: v.string() },
  handler: async (ctx, { entityId }): Promise<Doc<"contradictions">[]> => {
    return await ctx.db
      .query("contradictions")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId))
      .filter((q) => q.eq(q.field("status"), "unresolved"))
      .collect() as Doc<"contradictions">[];
  },
});

/**
 * Get all unresolved contradictions
 */
export const getUnresolvedContradictions = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 100 }): Promise<Doc<"contradictions">[]> => {
    return await ctx.db
      .query("contradictions")
      .withIndex("by_status", (q) => q.eq("status", "unresolved"))
      .take(limit) as Doc<"contradictions">[];
  },
});

/**
 * Get high-severity contradictions requiring attention
 */
export const getCriticalContradictions = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"contradictions">[]> => {
    const contradictions = await ctx.db
      .query("contradictions")
      .withIndex("by_status", (q) => q.eq("status", "unresolved"))
      .collect() as Doc<"contradictions">[];

    return contradictions.filter(
      (c: Doc<"contradictions">) => c.severity === "critical" || c.severity === "high"
    );
  },
});

/**
 * Get contradiction stats for dashboard
 */
export const getContradictionStats = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    total: number;
    unresolved: number;
    resolved: number;
    bySeverity: Record<string, number>;
    byField: Record<string, number>;
  }> => {
    const contradictions = await ctx.db.query("contradictions").collect() as Doc<"contradictions">[];

    const stats = {
      total: contradictions.length,
      unresolved: 0,
      resolved: 0,
      bySeverity: {} as Record<string, number>,
      byField: {} as Record<string, number>,
    };

    for (const c of contradictions) {
      if (c.status === "unresolved") {
        stats.unresolved++;
      } else {
        stats.resolved++;
      }

      stats.bySeverity[c.severity] = (stats.bySeverity[c.severity] || 0) + 1;
      stats.byField[c.field] = (stats.byField[c.field] || 0) + 1;
    }

    return stats;
  },
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Record a new contradiction
 */
export const recordContradiction = internalMutation({
  args: {
    entityId: v.string(),
    field: v.string(),
    factA: v.object({
      content: v.string(),
      source: v.string(),
      timestamp: v.number(),
      confidence: v.number(),
    }),
    factB: v.object({
      content: v.string(),
      source: v.string(),
      timestamp: v.number(),
      confidence: v.number(),
    }),
    conflictType: v.union(
      v.literal("value"),
      v.literal("date"),
      v.literal("status"),
      v.literal("attribution")
    ),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical")
    ),
    suggestedResolution: v.optional(
      v.object({
        strategy: v.string(),
        suggestedValue: v.string(),
        confidence: v.number(),
        reasoning: v.string(),
      })
    ),
  },
  handler: async (ctx, args): Promise<Id<"contradictions">> => {
    return await ctx.db.insert("contradictions", {
      entityId: args.entityId,
      field: args.field,
      factA: args.factA,
      factB: args.factB,
      conflictType: args.conflictType,
      severity: args.severity,
      suggestedResolution: args.suggestedResolution,
      status: "unresolved",
      detectedAt: Date.now(),
    });
  },
});

/**
 * Resolve a contradiction
 */
export const resolveContradiction = internalMutation({
  args: {
    contradictionId: v.id("contradictions"),
    resolution: v.union(
      v.literal("accepted_a"),
      v.literal("accepted_b"),
      v.literal("merged"),
      v.literal("dismissed")
    ),
    resolvedValue: v.optional(v.string()),
    resolvedBy: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.contradictionId, {
      status: "resolved",
      resolution: args.resolution,
      resolvedValue: args.resolvedValue,
      resolvedBy: args.resolvedBy || "system",
      resolvedAt: Date.now(),
    });
  },
});

/**
 * Batch record contradictions from analysis
 */
export const batchRecordContradictions = internalMutation({
  args: {
    entityId: v.string(),
    contradictions: v.array(
      v.object({
        field: v.string(),
        factA: v.object({
          content: v.string(),
          source: v.string(),
          timestamp: v.number(),
          confidence: v.number(),
        }),
        factB: v.object({
          content: v.string(),
          source: v.string(),
          timestamp: v.number(),
          confidence: v.number(),
        }),
        conflictType: v.string(),
        severity: v.string(),
        suggestedResolution: v.optional(
          v.object({
            strategy: v.string(),
            suggestedValue: v.string(),
            confidence: v.number(),
            reasoning: v.string(),
          })
        ),
      })
    ),
  },
  handler: async (ctx, { entityId, contradictions }): Promise<number> => {
    let recorded = 0;

    for (const c of contradictions) {
      // Check if this contradiction already exists
      const existing = await ctx.db
        .query("contradictions")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .filter((q) =>
          q.and(
            q.eq(q.field("field"), c.field),
            q.eq(q.field("status"), "unresolved")
          )
        )
        .first() as Doc<"contradictions"> | null;

      if (!existing) {
        await ctx.db.insert("contradictions", {
          entityId,
          field: c.field,
          factA: c.factA,
          factB: c.factB,
          conflictType: c.conflictType as "value" | "date" | "status" | "attribution",
          severity: c.severity as "low" | "medium" | "high" | "critical",
          suggestedResolution: c.suggestedResolution,
          status: "unresolved",
          detectedAt: Date.now(),
        });
        recorded++;
      }
    }

    return recorded;
  },
});

/* ================================================================== */
/* ACTIONS                                                             */
/* ================================================================== */

/**
 * Analyze entity for contradictions
 */
export const analyzeEntityContradictions = internalAction({
  args: {
    entityId: v.string(),
    facts: v.array(
      v.object({
        content: v.string(),
        field: v.string(),
        source: v.string(),
        timestamp: v.number(),
      })
    ),
  },
  handler: async (ctx, { entityId, facts }): Promise<ContradictionAnalysis> => {
    const contradictions: ContradictionCandidate[] = [];
    const resolutions: ResolutionSuggestion[] = [];

    // Compare all facts pairwise
    for (let i = 0; i < facts.length; i++) {
      for (let j = i + 1; j < facts.length; j++) {
        const contradiction = detectContradiction(facts[i], facts[j]);
        if (contradiction) {
          contradictions.push(contradiction);
          resolutions.push(suggestResolution(contradiction));
        }
      }
    }

    // Record contradictions in database
    if (contradictions.length > 0) {
      await ctx.runMutation(
        internal.domains.validation.contradictionDetector.batchRecordContradictions,
        {
          entityId,
          contradictions: contradictions.map((c, idx) => ({
            field: c.field,
            factA: c.factA,
            factB: c.factB,
            conflictType: c.conflictType,
            severity: c.severity,
            suggestedResolution: resolutions[idx],
          })),
        }
      );
    }

    // Calculate overall integrity score
    const severityWeights = { low: 0.1, medium: 0.25, high: 0.5, critical: 1.0 };
    const totalPenalty = contradictions.reduce(
      (sum, c) => sum + severityWeights[c.severity],
      0
    );
    const overallIntegrity = Math.max(0, 100 - totalPenalty * 10);

    // Determine if manual review is needed
    const requiresManualReview = contradictions.some(
      (c) => c.severity === "critical" || c.severity === "high"
    );

    console.log(
      `[ContradictionDetector] Entity ${entityId}: ${contradictions.length} contradictions found, integrity: ${overallIntegrity.toFixed(1)}%`
    );

    return {
      entityId,
      contradictions,
      resolutions,
      overallIntegrity,
      requiresManualReview,
    };
  },
});

/**
 * Auto-resolve low-severity contradictions
 */
export const autoResolveContradictions = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }): Promise<number> => {
    const unresolved = await ctx.runQuery(
      internal.domains.validation.contradictionDetector.getUnresolvedContradictions,
      { limit }
    );

    let resolved = 0;

    for (const contradiction of unresolved as Doc<"contradictions">[]) {
      // Only auto-resolve low severity
      if (contradiction.severity !== "low") {
        continue;
      }

      // Use suggested resolution if confidence is high enough (using medium threshold)
      if (
        contradiction.suggestedResolution &&
        contradiction.suggestedResolution.confidence >= QUALITY_CONFIG.thresholds.confidenceMedium
      ) {
        await ctx.runMutation(
          internal.domains.validation.contradictionDetector.resolveContradiction,
          {
            contradictionId: contradiction._id,
            resolution:
              contradiction.suggestedResolution.strategy === "prefer_recent" ||
              contradiction.suggestedResolution.strategy === "prefer_credible"
                ? "accepted_a"
                : "merged",
            resolvedValue: contradiction.suggestedResolution.suggestedValue,
            resolvedBy: "auto",
          }
        );
        resolved++;
      }
    }

    console.log(`[ContradictionDetector] Auto-resolved ${resolved} low-severity contradictions`);
    return resolved;
  },
});

/**
 * Check entity integrity score
 */
export const checkEntityIntegrity = internalAction({
  args: { entityId: v.string() },
  handler: async (ctx, { entityId }): Promise<{ score: number; issues: string[] }> => {
    const contradictions = await ctx.runQuery(
      internal.domains.validation.contradictionDetector.getEntityContradictions,
      { entityId }
    );

    const severityWeights: Record<string, number> = { low: 5, medium: 15, high: 30, critical: 50 };
    let penalty = 0;
    const issues: string[] = [];

    for (const c of contradictions as Doc<"contradictions">[]) {
      penalty += severityWeights[c.severity] || 0;
      issues.push(`${c.severity.toUpperCase()}: Conflicting ${c.field} values from ${c.factA.source} vs ${c.factB.source}`);
    }

    return {
      score: Math.max(0, 100 - penalty),
      issues,
    };
  },
});
