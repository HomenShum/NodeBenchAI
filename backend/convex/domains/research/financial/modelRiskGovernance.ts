// convex/domains/financial/modelRiskGovernance.ts
// Model Risk Management (MRM) Style Documentation
//
// Provides enterprise-grade model governance artifacts for compliance.
// Aligned with regulatory frameworks (SR 11-7, OCC 2011-12, BCBS 239).
//
// ============================================================================
// WHY MODEL RISK GOVERNANCE MATTERS
// ============================================================================
//
// 1. REGULATORY REQUIREMENTS
//    - SR 11-7: Fed guidance on Model Risk Management
//    - OCC 2011-12: OCC model risk guidance
//    - Financial institutions must document all models
//    - Spreading to non-bank financial services
//
// 2. ENTERPRISE ADOPTION
//    - Risk/compliance teams need documentation before deployment
//    - Audit trail required for material decisions
//    - Model inventory required for larger organizations
//
// 3. OPERATIONAL RISK MANAGEMENT
//    - Known limitations must be documented
//    - Compensating controls must be identified
//    - Performance degradation must be tracked
//
// 4. REPRODUCIBILITY
//    - Model version tracking
//    - Input/output documentation
//    - Assumption documentation
//
// ============================================================================
// MRM DOCUMENTATION FRAMEWORK
// ============================================================================
//
// Level 1: Model Card (High-level overview for executives/auditors)
// Level 2: Technical Documentation (Detailed methodology for validators)
// Level 3: Validation Report (Independent review findings)
// Level 4: Performance Monitoring (Ongoing metrics)
//
// ============================================================================

import { v } from "convex/values";
import { internalMutation, mutation, query } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

/**
 * Model risk tier (determines governance requirements)
 */
export type ModelRiskTier = "tier1_critical" | "tier2_significant" | "tier3_standard" | "tier4_low";

/**
 * Model status in lifecycle
 */
export type ModelLifecycleStatus =
  | "development"    // Under development
  | "validation"     // Being validated
  | "approved"       // Approved for production
  | "restricted"     // Approved with restrictions
  | "deprecated"     // Superseded, scheduled for retirement
  | "retired";       // No longer in use

/**
 * Model use case category
 */
export type ModelUseCase =
  | "valuation"           // DCF, comparable companies, etc.
  | "risk_assessment"     // Due diligence risk scoring
  | "forecasting"         // Revenue/earnings projections
  | "classification"      // Entity classification
  | "data_extraction"     // XBRL parsing, etc.
  | "quality_scoring";    // Source quality, evaluation scoring

/**
 * Known limitation severity
 */
export type LimitationSeverity = "critical" | "high" | "medium" | "low";

/**
 * Model Card - High-level documentation for executives
 */
export interface ModelCard {
  /** Model identifier */
  modelId: string;

  /** Human-readable name */
  name: string;

  /** Version string */
  version: string;

  /** Brief description (2-3 sentences) */
  description: string;

  /** Risk tier */
  riskTier: ModelRiskTier;

  /** Current lifecycle status */
  status: ModelLifecycleStatus;

  /** Primary use case */
  useCase: ModelUseCase;

  /** Model owner (individual or team) */
  owner: string;

  /** Last validation date */
  lastValidationDate?: string;

  /** Next scheduled validation */
  nextValidationDate?: string;

  /** Key limitations (summary) */
  keyLimitations: string[];

  /** Compensating controls summary */
  compensatingControls: string[];

  /** Approval history */
  approvalHistory: Array<{
    date: string;
    approver: string;
    decision: "approved" | "approved_with_conditions" | "rejected";
    conditions?: string[];
  }>;
}

/**
 * Technical Documentation - Detailed methodology
 */
export interface TechnicalDocumentation {
  /** Model identifier */
  modelId: string;

  /** Version being documented */
  version: string;

  /** Methodology description */
  methodology: {
    /** High-level approach */
    approach: string;

    /** Key formulas/algorithms */
    keyFormulas: Array<{
      name: string;
      formula: string;
      description: string;
    }>;

    /** Data sources */
    dataSources: Array<{
      name: string;
      type: string;
      updateFrequency: string;
      qualityTier: string;
    }>;

    /** Key assumptions */
    keyAssumptions: Array<{
      assumption: string;
      rationale: string;
      sensitivityImpact: "high" | "medium" | "low";
    }>;
  };

  /** Input specifications */
  inputs: Array<{
    name: string;
    type: string;
    required: boolean;
    validRange?: string;
    description: string;
  }>;

  /** Output specifications */
  outputs: Array<{
    name: string;
    type: string;
    interpretation: string;
  }>;

  /** Known limitations with full detail */
  limitations: Array<{
    id: string;
    description: string;
    severity: LimitationSeverity;
    impact: string;
    compensatingControl?: string;
    monitoringApproach?: string;
  }>;

  /** Implementation notes */
  implementationNotes: string;

  /** Dependencies */
  dependencies: Array<{
    modelId: string;
    version: string;
    type: "input" | "output" | "shared_component";
  }>;
}

/**
 * Validation Report - Independent review findings
 */
export interface ValidationReport {
  /** Model identifier */
  modelId: string;

  /** Version validated */
  version: string;

  /** Validation date */
  validationDate: string;

  /** Validator information */
  validator: {
    name: string;
    organization?: string;
    qualifications?: string;
  };

  /** Validation scope */
  scope: {
    fullValidation: boolean;
    areasValidated: string[];
    areasExcluded: string[];
  };

  /** Test results */
  testResults: Array<{
    testName: string;
    category: "conceptual_soundness" | "developmental_evidence" | "outcomes_analysis";
    result: "pass" | "pass_with_findings" | "fail";
    findings?: string;
    recommendation?: string;
  }>;

  /** Overall assessment */
  overallAssessment: {
    conceptualSoundness: "strong" | "adequate" | "weak";
    developmentalEvidence: "strong" | "adequate" | "weak";
    outcomesAnalysis: "strong" | "adequate" | "weak";
    overallRating: "acceptable" | "acceptable_with_conditions" | "unacceptable";
  };

  /** Findings and recommendations */
  findings: Array<{
    id: string;
    severity: "critical" | "major" | "minor" | "observation";
    description: string;
    recommendation: string;
    managementResponse?: string;
    remediation?: {
      planned: boolean;
      targetDate?: string;
      status?: "open" | "in_progress" | "closed";
    };
  }>;

  /** Conclusion */
  conclusion: string;
}

/**
 * Performance Metrics - Ongoing monitoring
 */
export interface PerformanceMetrics {
  /** Model identifier */
  modelId: string;

  /** Version */
  version: string;

  /** Reporting period */
  period: {
    start: string;
    end: string;
  };

  /** Usage metrics */
  usage: {
    totalExecutions: number;
    uniqueUsers: number;
    averageLatencyMs: number;
    errorRate: number;
    inconclusiveRate: number;
  };

  /** Accuracy metrics (where applicable) */
  accuracy?: {
    metricName: string;
    value: number;
    benchmark: number;
    status: "within_tolerance" | "approaching_threshold" | "breached";
  }[];

  /** Stability metrics */
  stability: {
    inputDistributionDrift: boolean;
    outputDistributionDrift: boolean;
    anomaliesDetected: number;
  };

  /** Alert history */
  alerts: Array<{
    date: string;
    type: string;
    severity: string;
    description: string;
    resolution?: string;
  }>;
}

/* ------------------------------------------------------------------ */
/* RISK TIER CONFIGURATION                                             */
/* ------------------------------------------------------------------ */

/**
 * Risk tier governance requirements
 */
export const RISK_TIER_REQUIREMENTS: Record<
  ModelRiskTier,
  {
    validationFrequencyMonths: number;
    independentValidationRequired: boolean;
    documentationLevel: "full" | "standard" | "minimal";
    approvalLevel: "executive" | "senior" | "manager";
    monitoringFrequency: "daily" | "weekly" | "monthly";
  }
> = {
  tier1_critical: {
    validationFrequencyMonths: 6,
    independentValidationRequired: true,
    documentationLevel: "full",
    approvalLevel: "executive",
    monitoringFrequency: "daily",
  },
  tier2_significant: {
    validationFrequencyMonths: 12,
    independentValidationRequired: true,
    documentationLevel: "full",
    approvalLevel: "senior",
    monitoringFrequency: "weekly",
  },
  tier3_standard: {
    validationFrequencyMonths: 18,
    independentValidationRequired: false,
    documentationLevel: "standard",
    approvalLevel: "manager",
    monitoringFrequency: "monthly",
  },
  tier4_low: {
    validationFrequencyMonths: 24,
    independentValidationRequired: false,
    documentationLevel: "minimal",
    approvalLevel: "manager",
    monitoringFrequency: "monthly",
  },
};

/* ------------------------------------------------------------------ */
/* PRE-BUILT MODEL DOCUMENTATION                                       */
/* ------------------------------------------------------------------ */

/**
 * DCF Valuation Model documentation
 */
export const DCF_MODEL_CARD: ModelCard = {
  modelId: "dcf-valuation-v1",
  name: "Discounted Cash Flow Valuation Model",
  version: "1.0.0",
  description: `
    Computes enterprise value and implied share price using discounted cash flow methodology.
    Projects free cash flows over a forecast horizon and discounts to present value using WACC.
    Terminal value computed via perpetuity growth or exit multiple method.
  `.trim(),
  riskTier: "tier2_significant",
  status: "approved",
  useCase: "valuation",
  owner: "Financial Modeling Team",
  lastValidationDate: "2026-01-15",
  nextValidationDate: "2027-01-15",
  keyLimitations: [
    "Terminal value highly sensitive to perpetuity growth rate assumption",
    "WACC estimation requires external beta sources which may be stale",
    "Does not account for optionality (real options)",
    "Assumes constant cost of capital over forecast period",
    "Limited handling of non-standard capital structures",
  ],
  compensatingControls: [
    "Sensitivity matrix required for all valuations (WACC ± 2%, growth ± 1%)",
    "Terminal value cannot exceed 75% of enterprise value without manual override",
    "All beta sources must be < 90 days old",
    "Human review required for implied prices > 50% different from current market",
  ],
  approvalHistory: [
    {
      date: "2026-01-15",
      approver: "Model Risk Committee",
      decision: "approved_with_conditions",
      conditions: ["Sensitivity matrix mandatory", "Terminal value cap enforced"],
    },
  ],
};

/**
 * XBRL Data Extraction Model documentation
 */
export const XBRL_EXTRACTION_MODEL_CARD: ModelCard = {
  modelId: "xbrl-extraction-v1",
  name: "SEC XBRL Financial Data Extraction",
  version: "1.0.0",
  description: `
    Extracts normalized financial fundamentals from SEC EDGAR XBRL filings.
    Handles US-GAAP and IFRS taxonomies with tag deprecation normalization.
    Implements CONSOLIDATED_ONLY dimensional strategy for consistency.
  `.trim(),
  riskTier: "tier3_standard",
  status: "approved",
  useCase: "data_extraction",
  owner: "Data Engineering Team",
  lastValidationDate: "2026-01-10",
  nextValidationDate: "2027-07-10",
  keyLimitations: [
    "Custom company-specific XBRL tags may not be recognized",
    "Segment-level data not extracted (CONSOLIDATED_ONLY strategy)",
    "IFRS filers with non-standard period definitions may have alignment issues",
    "Restatements require re-ingestion to update historical data",
    "Taxonomy versions older than 2018 have limited tag coverage",
  ],
  compensatingControls: [
    "Custom tag detection flags records for manual review",
    "Extraction confidence score below 0.7 triggers review",
    "Balance sheet equation validation (A = L + E)",
    "Year-over-year change limits for anomaly detection",
    "Taxonomy version logged for reproducibility",
  ],
  approvalHistory: [
    {
      date: "2026-01-10",
      approver: "Data Quality Team Lead",
      decision: "approved",
    },
  ],
};

/**
 * Source Quality Scoring Model documentation
 */
export const SOURCE_QUALITY_MODEL_CARD: ModelCard = {
  modelId: "source-quality-v1",
  name: "Source Quality Scoring Model",
  version: "1.0.0",
  description: `
    Scores the quality and reliability of data sources used in analysis.
    Implements 5-tier classification system from authoritative (Tier 1) to unverified (Tier 5).
    Combines URL pattern matching, freshness validation, and metadata checks.
  `.trim(),
  riskTier: "tier3_standard",
  status: "approved",
  useCase: "quality_scoring",
  owner: "Data Quality Team",
  lastValidationDate: "2026-01-05",
  nextValidationDate: "2027-07-05",
  keyLimitations: [
    "URL patterns may not cover all authoritative sources",
    "Freshness scoring based on filing date, not content date",
    "Cannot detect fabricated or manipulated content within sources",
    "New domains require manual addition to tier rules",
  ],
  compensatingControls: [
    "Unknown domains default to Tier 5 (unverified)",
    "Sources with quality score < 50 require additional verification",
    "Automated monitoring for new high-usage domains",
    "Quarterly review of tier rule effectiveness",
  ],
  approvalHistory: [
    {
      date: "2026-01-05",
      approver: "Data Quality Team Lead",
      decision: "approved",
    },
  ],
};

/* ------------------------------------------------------------------ */
/* CONVEX QUERIES & MUTATIONS                                          */
/* ------------------------------------------------------------------ */

/**
 * Get model card by ID
 */
export const getModelCard = query({
  args: {
    modelId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("modelCards"),
      modelId: v.string(),
      name: v.string(),
      version: v.string(),
      description: v.string(),
      riskTier: v.string(),
      status: v.string(),
      useCase: v.string(),
      owner: v.string(),
      lastValidationDate: v.optional(v.string()),
      nextValidationDate: v.optional(v.string()),
      keyLimitations: v.array(v.string()),
      compensatingControls: v.array(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const card = await ctx.db
      .query("modelCards")
      .withIndex("by_model_id", (q) => q.eq("modelId", args.modelId))
      .first();

    if (!card) return null;

    return {
      _id: card._id,
      modelId: card.modelId,
      name: card.name,
      version: card.version,
      description: card.description,
      riskTier: card.riskTier,
      status: card.status,
      useCase: card.useCase,
      owner: card.owner,
      lastValidationDate: card.lastValidationDate,
      nextValidationDate: card.nextValidationDate,
      keyLimitations: card.keyLimitations,
      compensatingControls: card.compensatingControls,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };
  },
});

/**
 * List all model cards
 */
export const listModelCards = query({
  args: {
    riskTier: v.optional(v.string()),
    status: v.optional(v.string()),
    useCase: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      modelId: v.string(),
      name: v.string(),
      version: v.string(),
      riskTier: v.string(),
      status: v.string(),
      useCase: v.string(),
      owner: v.string(),
      nextValidationDate: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    let query = ctx.db.query("modelCards");

    if (args.status) {
      query = query.filter((q) => q.eq(q.field("status"), args.status));
    }

    const cards = await query.collect();

    let filtered = cards;

    if (args.riskTier) {
      filtered = filtered.filter((c) => c.riskTier === args.riskTier);
    }

    if (args.useCase) {
      filtered = filtered.filter((c) => c.useCase === args.useCase);
    }

    return filtered.map((c) => ({
      modelId: c.modelId,
      name: c.name,
      version: c.version,
      riskTier: c.riskTier,
      status: c.status,
      useCase: c.useCase,
      owner: c.owner,
      nextValidationDate: c.nextValidationDate,
    }));
  },
});

/**
 * Get models requiring validation
 */
export const getModelsRequiringValidation = query({
  args: {
    daysAhead: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      modelId: v.string(),
      name: v.string(),
      riskTier: v.string(),
      nextValidationDate: v.string(),
      daysUntilValidation: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const daysAhead = args.daysAhead ?? 90;
    const now = Date.now();
    const cutoff = now + daysAhead * 24 * 60 * 60 * 1000;

    const cards = await ctx.db
      .query("modelCards")
      .filter((q) =>
        q.and(
          q.neq(q.field("nextValidationDate"), undefined),
          q.eq(q.field("status"), "approved")
        )
      )
      .collect();

    const requiresValidation = cards
      .filter((c) => {
        if (!c.nextValidationDate) return false;
        const validationDate = new Date(c.nextValidationDate).getTime();
        return validationDate <= cutoff;
      })
      .map((c) => {
        const validationDate = new Date(c.nextValidationDate!).getTime();
        const daysUntil = Math.ceil((validationDate - now) / (24 * 60 * 60 * 1000));
        return {
          modelId: c.modelId,
          name: c.name,
          riskTier: c.riskTier,
          nextValidationDate: c.nextValidationDate!,
          daysUntilValidation: daysUntil,
        };
      })
      .sort((a, b) => a.daysUntilValidation - b.daysUntilValidation);

    return requiresValidation;
  },
});

/**
 * Upsert model card
 */
export const upsertModelCard = mutation({
  args: {
    modelId: v.string(),
    name: v.string(),
    version: v.string(),
    description: v.string(),
    riskTier: v.string(),
    status: v.string(),
    useCase: v.string(),
    owner: v.string(),
    lastValidationDate: v.optional(v.string()),
    nextValidationDate: v.optional(v.string()),
    keyLimitations: v.array(v.string()),
    compensatingControls: v.array(v.string()),
  },
  returns: v.object({
    id: v.id("modelCards"),
    action: v.union(v.literal("created"), v.literal("updated")),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("modelCards")
      .withIndex("by_model_id", (q) => q.eq("modelId", args.modelId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        version: args.version,
        description: args.description,
        riskTier: args.riskTier,
        status: args.status,
        useCase: args.useCase,
        owner: args.owner,
        lastValidationDate: args.lastValidationDate,
        nextValidationDate: args.nextValidationDate,
        keyLimitations: args.keyLimitations,
        compensatingControls: args.compensatingControls,
        updatedAt: Date.now(),
      });
      return { id: existing._id, action: "updated" };
    }

    const id = await ctx.db.insert("modelCards", {
      modelId: args.modelId,
      name: args.name,
      version: args.version,
      description: args.description,
      riskTier: args.riskTier,
      status: args.status,
      useCase: args.useCase,
      owner: args.owner,
      lastValidationDate: args.lastValidationDate,
      nextValidationDate: args.nextValidationDate,
      keyLimitations: args.keyLimitations,
      compensatingControls: args.compensatingControls,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { id, action: "created" };
  },
});

/**
 * Record model performance metrics
 */
export const recordPerformanceMetrics = internalMutation({
  args: {
    modelId: v.string(),
    version: v.string(),
    periodStart: v.string(),
    periodEnd: v.string(),
    totalExecutions: v.number(),
    uniqueUsers: v.number(),
    averageLatencyMs: v.number(),
    errorRate: v.number(),
    inconclusiveRate: v.number(),
  },
  returns: v.id("modelPerformanceMetrics"),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("modelPerformanceMetrics", {
      modelId: args.modelId,
      version: args.version,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      totalExecutions: args.totalExecutions,
      uniqueUsers: args.uniqueUsers,
      averageLatencyMs: args.averageLatencyMs,
      errorRate: args.errorRate,
      inconclusiveRate: args.inconclusiveRate,
      recordedAt: Date.now(),
    });

    return id;
  },
});

/* ------------------------------------------------------------------ */
/* HELPER FUNCTIONS                                                    */
/* ------------------------------------------------------------------ */

/**
 * Determine risk tier based on model characteristics
 */
export function determineRiskTier(characteristics: {
  usedInDecisionMaking: boolean;
  affectsRevenue: boolean;
  regulatoryRequired: boolean;
  hasExternalDependencies: boolean;
  complexityLevel: "high" | "medium" | "low";
}): ModelRiskTier {
  // Tier 1: Critical models with material impact
  if (
    characteristics.regulatoryRequired ||
    (characteristics.usedInDecisionMaking && characteristics.affectsRevenue)
  ) {
    return "tier1_critical";
  }

  // Tier 2: Significant models
  if (
    characteristics.usedInDecisionMaking ||
    characteristics.complexityLevel === "high"
  ) {
    return "tier2_significant";
  }

  // Tier 3: Standard models
  if (
    characteristics.hasExternalDependencies ||
    characteristics.complexityLevel === "medium"
  ) {
    return "tier3_standard";
  }

  // Tier 4: Low risk models
  return "tier4_low";
}

/**
 * Calculate next validation date based on risk tier
 */
export function calculateNextValidationDate(
  riskTier: ModelRiskTier,
  lastValidationDate: Date = new Date()
): Date {
  const requirements = RISK_TIER_REQUIREMENTS[riskTier];
  const nextDate = new Date(lastValidationDate);
  nextDate.setMonth(nextDate.getMonth() + requirements.validationFrequencyMonths);
  return nextDate;
}

/**
 * Check if model documentation is complete
 */
export function checkDocumentationCompleteness(card: ModelCard): {
  complete: boolean;
  missingItems: string[];
} {
  const missingItems: string[] = [];

  if (!card.description || card.description.length < 50) {
    missingItems.push("Detailed description (minimum 50 characters)");
  }

  if (card.keyLimitations.length === 0) {
    missingItems.push("Key limitations");
  }

  if (card.compensatingControls.length === 0) {
    missingItems.push("Compensating controls");
  }

  if (!card.owner) {
    missingItems.push("Model owner");
  }

  const requirements = RISK_TIER_REQUIREMENTS[card.riskTier];
  if (requirements.documentationLevel === "full") {
    if (card.approvalHistory.length === 0) {
      missingItems.push("Approval history");
    }
    if (!card.lastValidationDate) {
      missingItems.push("Last validation date");
    }
  }

  return {
    complete: missingItems.length === 0,
    missingItems,
  };
}

/**
 * Export model inventory for regulatory reporting
 */
export function exportModelInventory(
  cards: ModelCard[]
): Array<{
  modelId: string;
  name: string;
  riskTier: string;
  status: string;
  useCase: string;
  owner: string;
  lastValidation: string;
  nextValidation: string;
  limitationCount: number;
  controlCount: number;
}> {
  return cards.map((card) => ({
    modelId: card.modelId,
    name: card.name,
    riskTier: card.riskTier,
    status: card.status,
    useCase: card.useCase,
    owner: card.owner,
    lastValidation: card.lastValidationDate ?? "N/A",
    nextValidation: card.nextValidationDate ?? "N/A",
    limitationCount: card.keyLimitations.length,
    controlCount: card.compensatingControls.length,
  }));
}
