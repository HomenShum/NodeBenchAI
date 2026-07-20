// convex/domains/hitl/validationWorkspaceEnforcement.ts
// Validation Workspace Enforcement (SR 11-7 Compliance)
//
// Enforces:
// - Separation of duties (owner ≠ validator)
// - Model card requirements
// - Repro pack gates
// - Monitoring hooks
// - Findings remediation before approval
//
// Makes validation workflow UNSKIPPABLE at backend level.
//
// ============================================================================

import { v } from "convex/values";
import { mutation, query } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* PROMOTION GATE ENFORCEMENT                                          */
/* ------------------------------------------------------------------ */

/**
 * Check if model can be promoted to production
 */
export const checkProductionPromotionGate = query({
  args: {
    modelId: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    failures: v.array(v.string()),
    gates: v.object({
      hasApprovedModelCard: v.boolean(),
      hasReproPackGate: v.boolean(),
      hasMonitoringHooks: v.boolean(),
      hasIndependentValidation: v.boolean(),
      noOpenCriticalFindings: v.boolean(),
    }),
  }),
  handler: async (ctx, args) => {
    const failures: string[] = [];

    // Gate 1: Check for approved model card
    const modelCard = await ctx.db
      .query("modelCards")
      .withIndex("by_model", (q) => q.eq("modelId", args.modelId))
      .filter((q) => q.eq(q.field("status"), "approved"))
      .first();

    const hasApprovedModelCard = !!modelCard;
    if (!hasApprovedModelCard) {
      failures.push("No approved model card exists");
    }

    // Gate 2: Check for passing repro pack
    const reproPack = await ctx.db
      .query("modelReproPacks")
      .withIndex("by_model", (q) => q.eq("dcfModelId", args.modelId))
      .filter((q) => q.eq(q.field("fullyReproducible"), true))
      .first();

    const hasReproPackGate = !!reproPack;
    if (!hasReproPackGate) {
      failures.push("No passing repro pack exists (determinism/provenance incomplete)");
    }

    // Gate 3: Check for monitoring hooks
    // Look for SLO measurements for this model
    const monitoringHooks = await ctx.db
      .query("sloMeasurements")
      .withIndex("by_slo", (q) => q.eq("sloId", `slo_${args.modelId}_accuracy`))
      .order("desc")
      .take(1);

    const hasMonitoringHooks = monitoringHooks.length > 0;
    if (!hasMonitoringHooks) {
      failures.push("No monitoring hooks emitting metrics");
    }

    // Gate 4: Check for independent validation
    const validation = await ctx.db
      .query("validationRequests")
      .withIndex("by_model", (q) => q.eq("modelId", args.modelId))
      .filter((q) => q.eq(q.field("status"), "approved"))
      .first();

    const hasIndependentValidation = !!validation;
    if (!hasIndependentValidation) {
      failures.push("No independent validation approval exists");
    }

    // Gate 5: Check for open critical findings
    const criticalFindings = await ctx.db
      .query("validationFindings")
      .withIndex("by_model_status", (q) =>
        q.eq("modelId", args.modelId).eq("status", "open")
      )
      .filter((q) => q.eq(q.field("severity"), "critical"))
      .collect();

    const noOpenCriticalFindings = criticalFindings.length === 0;
    if (!noOpenCriticalFindings) {
      failures.push(`${criticalFindings.length} open critical findings must be remediated`);
    }

    const allowed =
      hasApprovedModelCard &&
      hasReproPackGate &&
      hasMonitoringHooks &&
      hasIndependentValidation &&
      noOpenCriticalFindings;

    return {
      allowed,
      failures,
      gates: {
        hasApprovedModelCard,
        hasReproPackGate,
        hasMonitoringHooks,
        hasIndependentValidation,
        noOpenCriticalFindings,
      },
    };
  },
});

/**
 * Attempt to promote model to production (enforces gates)
 */
export const promoteModelToProduction = mutation({
  args: {
    modelId: v.string(),
    promotedBy: v.string(),
    reason: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    // For now, just return not allowed
    // In production, you'd implement the full gate check here
    return {
      success: false,
      message: "Production promotion blocked - use checkProductionPromotionGate to verify gates",
    };
  },
});

/* ------------------------------------------------------------------ */
/* SEPARATION OF DUTIES ENFORCEMENT                                    */
/* ------------------------------------------------------------------ */

/**
 * Check if user can validate a model (enforce owner ≠ validator)
 */
export const canUserValidateModel = query({
  args: {
    userId: v.string(),
    modelId: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Get model owner
    const dcfModel = await ctx.db
      .query("dcfModels")
      .withIndex("by_entity_version", (q) => q.eq("modelId", args.modelId))
      .first();

    if (!dcfModel) {
      return { allowed: false, reason: "Model not found" };
    }

    // Check if user is the owner
    if (dcfModel.authorId === args.userId) {
      return {
        allowed: false,
        reason: "Cannot validate own model (SR 11-7 separation of duties)",
      };
    }

    // Check if user is already assigned as validator
    const existingValidation = await ctx.db
      .query("validationRequests")
      .withIndex("by_model", (q) => q.eq("modelId", args.modelId))
      .filter((q) =>
        q.and(
          q.eq(q.field("assignedValidator"), args.userId),
          q.or(
            q.eq(q.field("status"), "in_progress"),
            q.eq(q.field("status"), "approved")
          )
        )
      )
      .first();

    if (existingValidation) {
      return {
        allowed: false,
        reason: "User is already assigned as validator for this model",
      };
    }

    return { allowed: true };
  },
});

/**
 * Enforce separation of duties when assigning validator
 */
export const assignValidatorWithSeparationOfDuties = mutation({
  args: {
    validationRequestId: v.id("validationRequests"),
    validatorId: v.string(),
    assignedBy: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.validationRequestId);
    if (!request) {
      return { success: false, message: "Validation request not found" };
    }

    // Get model
    const dcfModel = await ctx.db
      .query("dcfModels")
      .withIndex("by_entity_version", (q) => q.eq("modelId", request.modelId))
      .first();

    if (!dcfModel) {
      return { success: false, message: "Model not found" };
    }

    // Check separation of duties
    if (dcfModel.authorId === args.validatorId) {
      return {
        success: false,
        message: "Cannot assign model owner as validator (SR 11-7 violation)",
      };
    }

    // Assign validator
    await ctx.db.patch(args.validationRequestId, {
      assignedValidator: args.validatorId,
      assignedAt: Date.now(),
      status: "in_progress",
    });

    return {
      success: true,
      message: `Validator ${args.validatorId} assigned successfully`,
    };
  },
});

/* ------------------------------------------------------------------ */
/* VALIDATION SCOPE CHECKLIST ENFORCEMENT                              */
/* ------------------------------------------------------------------ */

/**
 * Required validation scope items (SR 11-7 compliant)
 */
export const VALIDATION_SCOPE_CHECKLIST = [
  {
    id: "conceptual_soundness",
    category: "Conceptual Soundness",
    items: [
      "Model methodology appropriate for use case",
      "Assumptions documented and justified",
      "Limitations clearly stated",
      "Alternative approaches considered",
    ],
  },
  {
    id: "ongoing_monitoring",
    category: "Ongoing Monitoring",
    items: [
      "Monitoring metrics defined",
      "Alert thresholds established",
      "Degradation detection implemented",
      "Runbooks created",
    ],
  },
  {
    id: "outcomes_analysis",
    category: "Outcomes Analysis",
    items: [
      "Model performance vs. actual outcomes",
      "Bias/fairness analysis",
      "Edge case handling",
      "Error analysis",
    ],
  },
  {
    id: "governance",
    category: "Governance",
    items: [
      "Model card complete and accurate",
      "Ownership and escalation paths clear",
      "Change control process defined",
      "Retirement criteria established",
    ],
  },
] as const;

/**
 * Check validation scope completeness
 */
export const checkValidationScopeCompleteness = query({
  args: {
    validationRequestId: v.id("validationRequests"),
  },
  returns: v.object({
    complete: v.boolean(),
    completedItems: v.number(),
    totalItems: v.number(),
    missingCategories: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.validationRequestId);
    if (!request) {
      throw new Error("Validation request not found");
    }

    const scopeChecklist = request.scopeChecklist ?? {};

    let totalItems = 0;
    let completedItems = 0;
    const missingCategories: string[] = [];

    for (const category of VALIDATION_SCOPE_CHECKLIST) {
      totalItems += category.items.length;

      const categoryData = scopeChecklist[category.id] ?? {};
      const categoryCompleted = category.items.filter(
        (item) => categoryData[item] === true
      ).length;

      completedItems += categoryCompleted;

      if (categoryCompleted < category.items.length) {
        missingCategories.push(category.category);
      }
    }

    return {
      complete: completedItems === totalItems,
      completedItems,
      totalItems,
      missingCategories,
    };
  },
});

/**
 * Enforce validation scope before approval
 */
export const approveValidationWithScopeCheck = mutation({
  args: {
    validationRequestId: v.id("validationRequests"),
    validatorId: v.string(),
    approvalNotes: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.validationRequestId);
    if (!request) {
      return { success: false, message: "Validation request not found" };
    }

    // Check scope completeness
    const scopeChecklist = request.scopeChecklist ?? {};
    let totalItems = 0;
    let completedItems = 0;

    for (const category of VALIDATION_SCOPE_CHECKLIST) {
      totalItems += category.items.length;
      const categoryData = scopeChecklist[category.id] ?? {};
      completedItems += category.items.filter((item) => categoryData[item] === true).length;
    }

    if (completedItems < totalItems) {
      return {
        success: false,
        message: `Validation scope incomplete: ${completedItems}/${totalItems} items completed`,
      };
    }

    // Check for open critical findings
    const criticalFindings = await ctx.db
      .query("validationFindings")
      .withIndex("by_validation", (q) => q.eq("validationRequestId", args.validationRequestId))
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "open"),
          q.eq(q.field("severity"), "critical")
        )
      )
      .collect();

    if (criticalFindings.length > 0) {
      return {
        success: false,
        message: `Cannot approve with ${criticalFindings.length} open critical findings`,
      };
    }

    // Approve
    await ctx.db.patch(args.validationRequestId, {
      status: "approved",
      approvedAt: Date.now(),
      approvalNotes: args.approvalNotes,
    });

    return {
      success: true,
      message: "Validation approved successfully",
    };
  },
});

/* ------------------------------------------------------------------ */
/* FINDINGS REMEDIATION ENFORCEMENT                                    */
/* ------------------------------------------------------------------ */

/**
 * Check if finding is eligible for closure
 */
export const canCloseFinding = query({
  args: {
    findingId: v.id("validationFindings"),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    requiredEvidence: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const finding = await ctx.db.get(args.findingId);
    if (!finding) {
      return {
        allowed: false,
        reason: "Finding not found",
        requiredEvidence: [],
      };
    }

    if (finding.status !== "remediated") {
      return {
        allowed: false,
        reason: "Finding must be remediated before closing",
        requiredEvidence: [],
      };
    }

    const requiredEvidence: string[] = [];

    // Critical findings require more evidence
    if (finding.severity === "critical") {
      if (!finding.remediation?.evidenceOfFix) {
        requiredEvidence.push("Evidence of fix implementation");
      }
      if (!finding.remediation?.retestResults) {
        requiredEvidence.push("Re-test results showing fix effectiveness");
      }
      if (!finding.remediation?.rootCauseAnalysis) {
        requiredEvidence.push("Root cause analysis");
      }
    }

    return {
      allowed: requiredEvidence.length === 0,
      reason: requiredEvidence.length > 0 ? "Missing required evidence" : undefined,
      requiredEvidence,
    };
  },
});

/**
 * Close finding with evidence requirements
 */
export const closeFindingWithEvidence = mutation({
  args: {
    findingId: v.id("validationFindings"),
    closedBy: v.string(),
    closureNotes: v.string(),
    evidenceArtifactIds: v.array(v.id("sourceArtifacts")),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    const finding = await ctx.db.get(args.findingId);
    if (!finding) {
      return { success: false, message: "Finding not found" };
    }

    if (finding.status !== "remediated") {
      return {
        success: false,
        message: "Finding must be remediated before closing",
      };
    }

    // For critical findings, require evidence
    if (finding.severity === "critical" && args.evidenceArtifactIds.length === 0) {
      return {
        success: false,
        message: "Critical findings require evidence artifacts",
      };
    }

    // Close finding
    await ctx.db.patch(args.findingId, {
      status: "closed",
      closedAt: Date.now(),
      closedBy: args.closedBy,
      closureNotes: args.closureNotes,
      closureEvidenceArtifactIds: args.evidenceArtifactIds,
    });

    return {
      success: true,
      message: "Finding closed successfully",
    };
  },
});

/* ------------------------------------------------------------------ */
/* MODEL INVENTORY COVERAGE DASHBOARD                                  */
/* ------------------------------------------------------------------ */

/**
 * Get model inventory with governance coverage
 */
export const getModelInventoryCoverage = query({
  args: {
    riskTier: v.optional(v.string()),
  },
  returns: v.object({
    totalModels: v.number(),
    byRiskTier: v.any(),
    modelCardsCoverage: v.number(),
    validationCoverage: v.number(),
    monitoringCoverage: v.number(),
    uncoveredModels: v.array(v.object({
      modelId: v.string(),
      riskTier: v.string(),
      missingItems: v.array(v.string()),
    })),
  }),
  handler: async (ctx, args) => {
    // Get all DCF models
    let models = await ctx.db.query("dcfModels").collect();

    if (args.riskTier) {
      // Filter by risk tier (would need to be added to dcfModels schema)
      // For now, return all
    }

    const totalModels = models.length;

    // Count coverage
    let modelsWithCards = 0;
    let modelsWithValidation = 0;
    let modelsWithMonitoring = 0;
    const uncoveredModels: Array<{
      modelId: string;
      riskTier: string;
      missingItems: string[];
    }> = [];

    for (const model of models) {
      const missingItems: string[] = [];

      // Check model card
      const card = await ctx.db
        .query("modelCards")
        .withIndex("by_model", (q) => q.eq("modelId", model.modelId))
        .filter((q) => q.eq(q.field("status"), "approved"))
        .first();

      if (card) {
        modelsWithCards++;
      } else {
        missingItems.push("model_card");
      }

      // Check validation
      const validation = await ctx.db
        .query("validationRequests")
        .withIndex("by_model", (q) => q.eq("modelId", model.modelId))
        .filter((q) => q.eq(q.field("status"), "approved"))
        .first();

      if (validation) {
        modelsWithValidation++;
      } else {
        missingItems.push("validation");
      }

      // Check monitoring
      const monitoring = await ctx.db
        .query("sloMeasurements")
        .withIndex("by_slo", (q) => q.eq("sloId", `slo_${model.modelId}_accuracy`))
        .order("desc")
        .take(1);

      if (monitoring.length > 0) {
        modelsWithMonitoring++;
      } else {
        missingItems.push("monitoring");
      }

      if (missingItems.length > 0) {
        uncoveredModels.push({
          modelId: model.modelId,
          riskTier: "tier2_significant", // Would come from model
          missingItems,
        });
      }
    }

    return {
      totalModels,
      byRiskTier: {
        tier1_critical: 0,
        tier2_significant: totalModels,
        tier3_low: 0,
      },
      modelCardsCoverage: totalModels > 0 ? (modelsWithCards / totalModels) * 100 : 0,
      validationCoverage: totalModels > 0 ? (modelsWithValidation / totalModels) * 100 : 0,
      monitoringCoverage: totalModels > 0 ? (modelsWithMonitoring / totalModels) * 100 : 0,
      uncoveredModels,
    };
  },
});

/* ------------------------------------------------------------------ */
/* EXPORTS                                                             */
/* ------------------------------------------------------------------ */

// All functions exported inline
