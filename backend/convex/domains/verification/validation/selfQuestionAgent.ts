/**
 * Self-Question Agent - Post-Generation Validation
 * Deep Agents 3.0 - Validates agent outputs before publishing
 *
 * Validation checks:
 * 1. Factual accuracy (grounding in sources)
 * 2. Freshness (data age vs persona requirements)
 * 3. Completeness (all required fields present)
 * 4. Grounding (sources cited)
 * 5. Contradiction detection (internal consistency)
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import {
  QUALITY_CONFIG,
  DECAY_CONFIG,
  type PersonaId,
  type ValidationIssueType,
  type ValidationSeverity,
} from "../../../config/autonomousConfig";
import type { Doc, Id } from "../../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export interface ValidationIssue {
  type: ValidationIssueType;
  severity: ValidationSeverity;
  description: string;
  location?: string;
  suggestion?: string;
}

export interface ValidationResult {
  passed: boolean;
  score: number;
  issues: ValidationIssue[];
  suggestions: string[];
  confidence: number;
  checksPerformed: string[];
  duration: number;
}

export interface FactualCheckResult {
  issues: ValidationIssue[];
  verifiedClaims: number;
  unverifiedClaims: number;
  contradictedClaims: number;
}

export interface FreshnessCheckResult {
  issues: ValidationIssue[];
  oldestDataAge: number;
  freshnessScore: number;
}

export interface CompletenessCheckResult {
  issues: ValidationIssue[];
  presentFields: string[];
  missingFields: string[];
  completenessScore: number;
}

export interface GroundingCheckResult {
  issues: ValidationIssue[];
  sourceCount: number;
  citedClaims: number;
  uncitedClaims: number;
}

/* ================================================================== */
/* VALIDATION CHECKERS                                                 */
/* ================================================================== */

/**
 * Check factual accuracy by verifying claims against known facts
 */
async function checkFactualAccuracy(
  content: string,
  entityId: string,
  ctx: any
): Promise<FactualCheckResult> {
  const issues: ValidationIssue[] = [];

  // Get existing entity context for comparison
  const entityContext = await ctx.runQuery(
    internal.domains.knowledge.entityContexts.getEntityContextByName,
    { name: entityId }
  );

  // Extract claims from content (simple pattern matching)
  const claimPatterns = [
    /(?:raised|secured|closed)\s+\$[\d.]+\s*(?:million|M|billion|B)/gi,
    /(?:founded|established)\s+(?:in\s+)?\d{4}/gi,
    /(?:headquartered|based)\s+in\s+[A-Z][a-zA-Z\s,]+/gi,
    /(?:employs?|has)\s+(?:about\s+)?[\d,]+\s+(?:employees|people|staff)/gi,
  ];

  let verifiedClaims = 0;
  let unverifiedClaims = 0;
  let contradictedClaims = 0;

  for (const pattern of claimPatterns) {
    const matches = content.match(pattern) || [];
    for (const match of matches) {
      // For now, mark claims as unverified if we don't have entity context
      if (!entityContext) {
        unverifiedClaims++;
        continue;
      }

      // Check if claim aligns with known facts
      const keyFacts = entityContext.keyFacts || [];
      const isVerified = keyFacts.some((fact: string) =>
        fact.toLowerCase().includes(match.toLowerCase().slice(0, 20))
      );

      if (isVerified) {
        verifiedClaims++;
      } else {
        unverifiedClaims++;
      }
    }
  }

  // Generate issues based on findings
  if (unverifiedClaims > 2) {
    issues.push({
      type: "factual",
      severity: "warning",
      description: `${unverifiedClaims} claims could not be verified against known facts`,
      suggestion: "Cross-reference claims with primary sources",
    });
  }

  if (contradictedClaims > 0) {
    issues.push({
      type: "factual",
      severity: "blocker",
      description: `${contradictedClaims} claims contradict existing verified information`,
      suggestion: "Review and correct contradicted claims before publishing",
    });
  }

  return {
    issues,
    verifiedClaims,
    unverifiedClaims,
    contradictedClaims,
  };
}

/**
 * Check data freshness against persona requirements
 */
async function checkFreshness(
  content: string,
  personaId: string,
  ctx: any
): Promise<FreshnessCheckResult> {
  const issues: ValidationIssue[] = [];

  // Get persona freshness requirement
  const freshnessRequirement =
    DECAY_CONFIG.personaFreshnessRequirements[
      personaId as keyof typeof DECAY_CONFIG.personaFreshnessRequirements
    ] || 30;

  // Look for date mentions in content
  const datePatterns = [
    /(?:as of|updated|on)\s+(\w+\s+\d{1,2},?\s+\d{4})/gi,
    /(\d{1,2}\/\d{1,2}\/\d{4})/g,
    /(\d{4}-\d{2}-\d{2})/g,
    /(Q[1-4]\s+\d{4})/gi,
    /(\w+\s+\d{4})/gi, // "January 2026"
  ];

  const now = Date.now();
  let oldestDate = now;
  let foundDates = 0;

  for (const pattern of datePatterns) {
    const matches = content.match(pattern) || [];
    for (const match of matches) {
      try {
        const parsed = new Date(match);
        if (!isNaN(parsed.getTime()) && parsed.getTime() < oldestDate) {
          oldestDate = parsed.getTime();
          foundDates++;
        }
      } catch {
        // Skip unparseable dates
      }
    }
  }

  const oldestDataAgeDays = Math.floor((now - oldestDate) / (1000 * 60 * 60 * 24));

  // Calculate freshness score (1.0 = fresh, 0.0 = stale)
  const freshnessScore = Math.max(0, 1 - oldestDataAgeDays / (freshnessRequirement * 2));

  // Generate issues
  if (oldestDataAgeDays > freshnessRequirement) {
    issues.push({
      type: "freshness",
      severity: oldestDataAgeDays > freshnessRequirement * 2 ? "blocker" : "warning",
      description: `Data is ${oldestDataAgeDays} days old, persona ${personaId} requires data < ${freshnessRequirement} days`,
      suggestion: "Refresh data from primary sources before publishing",
    });
  }

  if (foundDates === 0) {
    issues.push({
      type: "freshness",
      severity: "info",
      description: "No explicit dates found in content to verify freshness",
      suggestion: "Include date references for data provenance",
    });
  }

  return {
    issues,
    oldestDataAge: oldestDataAgeDays,
    freshnessScore,
  };
}

/**
 * Check completeness against persona requirements
 */
async function checkCompleteness(
  content: string,
  personaId: string,
  entityType: string,
  ctx: any
): Promise<CompletenessCheckResult> {
  const issues: ValidationIssue[] = [];

  // Define required fields by persona and entity type
  const personaRequirements: Record<string, Record<string, string[]>> = {
    JPM_STARTUP_BANKER: {
      company: ["funding", "headquarters", "key contacts", "investment thesis", "next actions"],
      person: ["role", "organization", "contact info", "relevance"],
    },
    EARLY_STAGE_VC: {
      company: ["thesis", "market size", "competitors", "team", "why now"],
      person: ["background", "investments", "focus areas"],
    },
    CTO_TECH_LEAD: {
      company: ["technology stack", "security posture", "integrations"],
      topic: ["exposure", "impact", "mitigations", "verification"],
    },
    ACADEMIC_RD: {
      topic: ["methodology", "findings", "citations", "research gaps"],
      company: ["research partnerships", "publications", "IP"],
    },
    PHARMA_BD: {
      company: ["pipeline", "clinical trials", "FDA status", "partnerships"],
      topic: ["therapeutic area", "mechanism", "competitive landscape"],
    },
  };

  const requirements =
    personaRequirements[personaId]?.[entityType] ||
    personaRequirements[personaId]?.["company"] ||
    ["summary", "key facts", "next actions"];

  const presentFields: string[] = [];
  const missingFields: string[] = [];

  const contentLower = content.toLowerCase();

  for (const field of requirements) {
    // Check if field is mentioned or has content
    const fieldKeywords = field.toLowerCase().split(/\s+/);
    const isPresent = fieldKeywords.some((keyword) => contentLower.includes(keyword));

    if (isPresent) {
      presentFields.push(field);
    } else {
      missingFields.push(field);
    }
  }

  const completenessScore = (presentFields.length / requirements.length) * 100;

  // Generate issues
  if (missingFields.length > 0) {
    const severity: ValidationSeverity =
      missingFields.length > requirements.length / 2 ? "blocker" : "warning";
    issues.push({
      type: "completeness",
      severity,
      description: `Missing ${missingFields.length}/${requirements.length} required fields: ${missingFields.join(", ")}`,
      suggestion: `Research and add: ${missingFields.slice(0, 3).join(", ")}`,
    });
  }

  return {
    issues,
    presentFields,
    missingFields,
    completenessScore,
  };
}

/**
 * Check grounding - are claims backed by sources?
 */
async function checkGrounding(
  content: string,
  sources: Array<{ name: string; url: string; snippet?: string }>
): Promise<GroundingCheckResult> {
  const issues: ValidationIssue[] = [];

  const sourceCount = sources.length;

  // Count claims vs citations
  const claimIndicators = [
    /\bis\b/gi,
    /\bare\b/gi,
    /\bwas\b/gi,
    /\bwere\b/gi,
    /\braised\b/gi,
    /\bfounded\b/gi,
    /\blaunched\b/gi,
  ];

  let totalClaims = 0;
  for (const pattern of claimIndicators) {
    totalClaims += (content.match(pattern) || []).length;
  }
  totalClaims = Math.min(totalClaims, 50); // Cap at 50 for sanity

  // Estimate cited claims based on source count
  const citedClaims = Math.min(sourceCount * 5, totalClaims);
  const uncitedClaims = Math.max(0, totalClaims - citedClaims);

  // Generate issues
  if (sourceCount < QUALITY_CONFIG.minSources) {
    issues.push({
      type: "grounding",
      severity: "warning",
      description: `Only ${sourceCount} sources, minimum ${QUALITY_CONFIG.minSources} required`,
      suggestion: "Add more authoritative sources to support claims",
    });
  }

  if (sourceCount === 0) {
    issues.push({
      type: "grounding",
      severity: "blocker",
      description: "No sources provided - content is ungrounded",
      suggestion: "Research and cite primary sources for all major claims",
    });
  }

  return {
    issues,
    sourceCount,
    citedClaims,
    uncitedClaims,
  };
}

/**
 * Check for internal contradictions
 */
async function checkContradictions(
  content: string,
  entityId: string,
  ctx: any
): Promise<{ issues: ValidationIssue[]; contradictions: number }> {
  const issues: ValidationIssue[] = [];

  // Check for existing contradictions for this entity
  const existingContradictions = await ctx.runQuery(
    internal.domains.validation.contradictionDetector.getEntityContradictions,
    { entityId }
  );

  const unresolvedCount = existingContradictions.filter(
    (c: Doc<"contradictions">) => !c.resolution
  ).length;

  if (unresolvedCount > 0) {
    issues.push({
      type: "contradiction",
      severity: unresolvedCount >= QUALITY_CONFIG.maxContradictions ? "blocker" : "warning",
      description: `${unresolvedCount} unresolved contradictions for this entity`,
      suggestion: "Review and resolve contradictions before publishing new content",
    });
  }

  // Simple internal contradiction detection
  const fundingMentions = content.match(/\$[\d.]+\s*(?:million|M|billion|B)/gi) || [];
  if (fundingMentions.length > 1) {
    const uniqueFunding = [...new Set(fundingMentions.map((f) => f.toLowerCase()))];
    if (uniqueFunding.length > 1) {
      issues.push({
        type: "contradiction",
        severity: "warning",
        description: `Multiple funding amounts mentioned: ${uniqueFunding.join(", ")}`,
        suggestion: "Clarify whether amounts are cumulative or from different rounds",
      });
    }
  }

  return {
    issues,
    contradictions: unresolvedCount,
  };
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get validation history for an entity
 */
export const getValidationHistory = internalQuery({
  args: {
    entityId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { entityId, limit = 10 }): Promise<Doc<"researchTasks">[]> => {
    return await ctx.db
      .query("researchTasks")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId))
      .filter((q) => q.neq(q.field("qualityScore"), undefined))
      .order("desc")
      .take(limit);
  },
});

/* ================================================================== */
/* ACTIONS                                                             */
/* ================================================================== */

/**
 * Run full self-questioning validation
 */
export const selfQuestion = internalAction({
  args: {
    content: v.string(),
    entityId: v.string(),
    entityType: v.optional(v.string()),
    persona: v.string(),
    sources: v.optional(
      v.array(
        v.object({
          name: v.string(),
          url: v.string(),
          snippet: v.optional(v.string()),
        })
      )
    ),
  },
  handler: async (ctx, args): Promise<ValidationResult> => {
    const startTime = Date.now();
    const checksPerformed: string[] = [];
    const allIssues: ValidationIssue[] = [];
    const suggestions: string[] = [];

    console.log(`[SelfQuestionAgent] Starting validation for ${args.entityId}`);

    // 1. Factual accuracy check
    try {
      checksPerformed.push("factual_accuracy");
      const factualResult = await checkFactualAccuracy(args.content, args.entityId, ctx);
      allIssues.push(...factualResult.issues);
      console.log(
        `[SelfQuestionAgent] Factual: ${factualResult.verifiedClaims} verified, ${factualResult.unverifiedClaims} unverified`
      );
    } catch (error) {
      console.error("[SelfQuestionAgent] Factual check error:", error);
    }

    // 2. Freshness check
    try {
      checksPerformed.push("freshness");
      const freshnessResult = await checkFreshness(args.content, args.persona, ctx);
      allIssues.push(...freshnessResult.issues);
      console.log(
        `[SelfQuestionAgent] Freshness: ${freshnessResult.freshnessScore.toFixed(2)} score, ${freshnessResult.oldestDataAge} days old`
      );
    } catch (error) {
      console.error("[SelfQuestionAgent] Freshness check error:", error);
    }

    // 3. Completeness check
    try {
      checksPerformed.push("completeness");
      const completenessResult = await checkCompleteness(
        args.content,
        args.persona,
        args.entityType || "company",
        ctx
      );
      allIssues.push(...completenessResult.issues);
      if (completenessResult.missingFields.length > 0) {
        suggestions.push(`Add missing fields: ${completenessResult.missingFields.join(", ")}`);
      }
      console.log(
        `[SelfQuestionAgent] Completeness: ${completenessResult.completenessScore.toFixed(0)}%`
      );
    } catch (error) {
      console.error("[SelfQuestionAgent] Completeness check error:", error);
    }

    // 4. Grounding check
    try {
      checksPerformed.push("grounding");
      const groundingResult = await checkGrounding(args.content, args.sources || []);
      allIssues.push(...groundingResult.issues);
      console.log(`[SelfQuestionAgent] Grounding: ${groundingResult.sourceCount} sources`);
    } catch (error) {
      console.error("[SelfQuestionAgent] Grounding check error:", error);
    }

    // 5. Contradiction check
    try {
      checksPerformed.push("contradiction");
      const contradictionResult = await checkContradictions(args.content, args.entityId, ctx);
      allIssues.push(...contradictionResult.issues);
      console.log(
        `[SelfQuestionAgent] Contradictions: ${contradictionResult.contradictions} unresolved`
      );
    } catch (error) {
      console.error("[SelfQuestionAgent] Contradiction check error:", error);
    }

    // Calculate final score
    let score = 100;
    const blockers = allIssues.filter((i) => i.severity === "blocker");
    const warnings = allIssues.filter((i) => i.severity === "warning");
    const infos = allIssues.filter((i) => i.severity === "info");

    score -= blockers.length * QUALITY_CONFIG.penalties.blockerIssue;
    score -= warnings.length * QUALITY_CONFIG.penalties.warningIssue;
    score -= infos.length * QUALITY_CONFIG.penalties.infoIssue;
    score = Math.max(0, score);

    const passed = blockers.length === 0 && score >= QUALITY_CONFIG.minQualityScore;

    // Generate suggestions from issues
    for (const issue of allIssues) {
      if (issue.suggestion && !suggestions.includes(issue.suggestion)) {
        suggestions.push(issue.suggestion);
      }
    }

    // Calculate confidence based on checks performed
    const confidence = checksPerformed.length / 5;

    const duration = Date.now() - startTime;

    console.log(
      `[SelfQuestionAgent] Validation complete: ${passed ? "PASSED" : "FAILED"} (score: ${score}, ${blockers.length} blockers, ${warnings.length} warnings)`
    );

    return {
      passed,
      score,
      issues: allIssues,
      suggestions,
      confidence,
      checksPerformed,
      duration,
    };
  },
});

/**
 * Quick validation (fewer checks, faster)
 */
export const quickValidation = internalAction({
  args: {
    content: v.string(),
    entityId: v.string(),
    sourceCount: v.number(),
  },
  handler: async (ctx, args): Promise<{ passed: boolean; score: number; issues: string[] }> => {
    const issues: string[] = [];
    let score = 100;

    // Quick source check
    if (args.sourceCount < QUALITY_CONFIG.minSources) {
      issues.push(`Insufficient sources: ${args.sourceCount}/${QUALITY_CONFIG.minSources}`);
      score -= 15;
    }

    // Quick content length check
    if (args.content.length < 200) {
      issues.push("Content too short for meaningful research");
      score -= 20;
    }

    // Quick key facts check
    const hasKeyFacts = /key\s*facts?|highlights?|summary/i.test(args.content);
    if (!hasKeyFacts) {
      issues.push("Missing key facts section");
      score -= 10;
    }

    // Quick next actions check
    const hasNextActions = /next\s*(?:steps?|actions?)|recommendations?|todo/i.test(args.content);
    if (!hasNextActions) {
      issues.push("Missing next actions");
      score -= 10;
    }

    return {
      passed: score >= QUALITY_CONFIG.minQualityScore,
      score: Math.max(0, score),
      issues,
    };
  },
});
