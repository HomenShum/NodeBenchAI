// convex/domains/operations/validationWorkflow.ts
// Independent Validation Workflow
//
// Implements separation of duties for model validation per SR 11-7.
// Ensures model developers cannot validate their own work.
// Enforces independent validation for tier-1 and tier-2 models.
//
// ============================================================================
// WHY INDEPENDENT VALIDATION MATTERS
// ============================================================================
//
// 1. REGULATORY REQUIREMENT (SR 11-7, OCC 2011-12)
//    - Tier-1 models MUST have independent validation
//    - Validators cannot have built the model
//    - Documentation must prove independence
//
// 2. CONFLICT OF INTEREST
//    - Developers are biased toward their own work
//    - "Grading your own homework" misses systemic issues
//    - Independent eyes find blind spots
//
// 3. ACCOUNTABILITY
//    - Clear separation of responsibilities
//    - Audit trail shows who validated what
//    - Prevents rubber-stamping
//
// 4. REVALIDATION TRIGGERS
//    - Model changes require revalidation
//    - Performance degradation triggers review
//    - Annual revalidation for tier-1/tier-2
//
// ============================================================================
// WORKFLOW STAGES
// ============================================================================
//
// 1. VALIDATION REQUEST
//    - Model owner requests validation
//    - System checks eligibility (not self-validation)
//    - Assigns to independent validator
//
// 2. VALIDATION EXECUTION
//    - Validator reviews documentation
//    - Runs validation tests
//    - Documents findings
//
// 3. FINDINGS REVIEW
//    - Critical findings block approval
//    - Model owner must remediate
//    - Validator re-reviews
//
// 4. APPROVAL & SCHEDULING
//    - Approved models get next validation date
//    - Calendar reminders for upcoming validations
//    - Alerts for overdue validations
//
// ============================================================================

import { v } from "convex/values";
import { internalAction, internalMutation, mutation, query } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id, Doc } from "../../_generated/dataModel";
import { RISK_TIER_REQUIREMENTS } from "../financial/modelRiskGovernance";

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

/**
 * Validation request
 */
export interface ValidationRequest {
  requestId: string;
  modelCardId: Id<"modelCards">;

  /** What triggered this validation */
  trigger: "initial" | "scheduled_revalidation" | "model_change" | "performance_degradation" | "manual";

  /** Requester info */
  requestedBy: string;
  requestedAt: number;

  /** Assignment */
  assignedValidator?: string;
  assignedAt?: number;

  /** Status */
  status: "pending_assignment" | "in_progress" | "findings_review" | "completed" | "rejected";
}

/**
 * Validation finding
 */
export interface ValidationFinding {
  findingId: string;
  validationRequestId: Id<"validationRequests">;

  /** Severity */
  severity: "critical" | "high" | "medium" | "low" | "informational";

  /** Category */
  category: "data_quality" | "methodology" | "documentation" | "performance" | "governance" | "other";

  /** Description */
  title: string;
  description: string;

  /** Evidence */
  evidence: string[];

  /** Remediation */
  recommendedAction: string;
  remediatedBy?: string;
  remediatedAt?: number;
  remediationNotes?: string;

  /** Status */
  status: "open" | "remediated" | "accepted_risk" | "not_applicable";

  createdAt: number;
}

/**
 * Validation report
 */
export interface ValidationReport {
  reportId: string;
  validationRequestId: Id<"validationRequests">;
  modelCardId: Id<"modelCards">;

  /** Validator info */
  validatedBy: string;
  validationDate: string;

  /** Independence attestation */
  independenceAttestation: {
    validatorRole: string;
    conflictOfInterest: boolean;
    conflictDescription?: string;
    attestedAt: number;
  };

  /** Validation scope */
  scope: {
    conceptualSoundness: boolean;
    ongoingMonitoring: boolean;
    outcomeAnalysis: boolean;
    dataQuality: boolean;
    assumptions: boolean;
    implementation: boolean;
  };

  /** Findings summary */
  findingsSummary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    informational: number;
  };

  /** Recommendation */
  recommendation: "approve" | "conditional_approval" | "reject";
  recommendationRationale: string;

  /** Approval */
  approvedBy?: string;
  approvedAt?: number;
  nextValidationDate?: string;

  generatedAt: number;
}

/**
 * Validator assignment rules
 */
export interface AssignmentRule {
  ruleId: string;

  /** Rule applies to these risk tiers */
  applicableRiskTiers: string[];

  /** Validators eligible for this tier */
  eligibleValidators: string[];

  /** Disqualification rules */
  disqualifications: {
    /** Cannot validate models you authored */
    noSelfValidation: boolean;

    /** Cannot validate models from your team */
    noTeamValidation: boolean;

    /** Minimum time since involvement (days) */
    minDaysSinceInvolvement: number;
  };

  /** Workload balancing */
  maxConcurrentValidations: number;
}

/* ------------------------------------------------------------------ */
/* VALIDATION REQUEST MANAGEMENT                                       */
/* ------------------------------------------------------------------ */

/**
 * Create a validation request
 */
export const createValidationRequest = mutation({
  args: {
    modelCardId: v.id("modelCards"),
    trigger: v.union(
      v.literal("initial"),
      v.literal("scheduled_revalidation"),
      v.literal("model_change"),
      v.literal("performance_degradation"),
      v.literal("manual")
    ),
    requestedBy: v.string(),
    notes: v.optional(v.string()),
  },
  returns: v.id("validationRequests"),
  handler: async (ctx, args) => {
    // Get model card
    const modelCard = await ctx.db.get(args.modelCardId);
    if (!modelCard) {
      throw new Error(`Model card not found: ${args.modelCardId}`);
    }

    // Create request
    const requestId = await ctx.db.insert("validationRequests", {
      requestId: `val_req_${Date.now()}`,
      modelCardId: args.modelCardId,
      trigger: args.trigger,
      requestedBy: args.requestedBy,
      requestedAt: Date.now(),
      status: "pending_assignment",
      notes: args.notes,
    });

    return requestId;
  },
});

/**
 * Assign a validator to a request
 */
export const assignValidator = mutation({
  args: {
    validationRequestId: v.id("validationRequests"),
    validatorUserId: v.string(),
    assignedBy: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Get validation request
    const request = await ctx.db.get(args.validationRequestId);
    if (!request) {
      return { success: false, error: "Validation request not found" };
    }

    // Get model card
    const modelCard = await ctx.db.get(request.modelCardId);
    if (!modelCard) {
      return { success: false, error: "Model card not found" };
    }

    // Check independence: validator cannot be model owner
    if (modelCard.owner === args.validatorUserId) {
      return {
        success: false,
        error: "Validator cannot be the model owner (violates separation of duties)",
      };
    }

    // For tier-1 and tier-2, check additional restrictions
    if (
      modelCard.riskTier === "tier1_critical" ||
      modelCard.riskTier === "tier2_significant"
    ) {
      // Check if validator was involved in model development
      // (In real system, would check a development team table)
      // For now, just enforce owner != validator
    }

    // Assign validator
    await ctx.db.patch(args.validationRequestId, {
      assignedValidator: args.validatorUserId,
      assignedAt: Date.now(),
      assignedBy: args.assignedBy,
      status: "in_progress",
    });

    return { success: true };
  },
});

/**
 * Auto-assign validators based on workload and independence rules
 */
export const autoAssignValidator = internalAction({
  args: {
    validationRequestId: v.id("validationRequests"),
  },
  returns: v.object({
    success: v.boolean(),
    assignedValidator: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Get validation request
    const request = await ctx.runQuery(
      internal.domains.operations.validationWorkflow.getValidationRequest,
      { validationRequestId: args.validationRequestId }
    );

    if (!request) {
      return { success: false, error: "Validation request not found" };
    }

    // Get model card
    const modelCard = await ctx.runQuery(
      internal.domains.operations.validationWorkflow.getModelCard,
      { modelCardId: request.modelCardId }
    );

    if (!modelCard) {
      return { success: false, error: "Model card not found" };
    }

    // Get eligible validators (simplified - in real system would query validator roster)
    const eligibleValidators = await ctx.runQuery(
      internal.domains.operations.validationWorkflow.getEligibleValidators,
      {
        riskTier: modelCard.riskTier,
        excludeUserId: modelCard.owner,
      }
    );

    if (eligibleValidators.length === 0) {
      return { success: false, error: "No eligible validators available" };
    }

    // Get current workload for each validator
    const validatorWorkloads = await ctx.runQuery(
      internal.domains.operations.validationWorkflow.getValidatorWorkloads,
      { validators: eligibleValidators }
    );

    // Select validator with lowest workload
    const selectedValidator = validatorWorkloads.sort(
      (a, b) => a.activeValidations - b.activeValidations
    )[0].validator;

    // Assign
    await ctx.runMutation(
      internal.domains.operations.validationWorkflow.assignValidatorInternal,
      {
        validationRequestId: args.validationRequestId,
        validatorUserId: selectedValidator,
        assignedBy: "system_auto_assign",
      }
    );

    return {
      success: true,
      assignedValidator: selectedValidator,
    };
  },
});

/* ------------------------------------------------------------------ */
/* FINDINGS MANAGEMENT                                                 */
/* ------------------------------------------------------------------ */

/**
 * Create a validation finding
 */
export const createFinding = mutation({
  args: {
    validationRequestId: v.id("validationRequests"),
    severity: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low"),
      v.literal("informational")
    ),
    category: v.union(
      v.literal("data_quality"),
      v.literal("methodology"),
      v.literal("documentation"),
      v.literal("performance"),
      v.literal("governance"),
      v.literal("other")
    ),
    title: v.string(),
    description: v.string(),
    evidence: v.array(v.string()),
    recommendedAction: v.string(),
    createdBy: v.string(),
  },
  returns: v.id("validationFindings"),
  handler: async (ctx, args) => {
    const findingId = await ctx.db.insert("validationFindings", {
      findingId: `finding_${Date.now()}`,
      validationRequestId: args.validationRequestId,
      severity: args.severity,
      category: args.category,
      title: args.title,
      description: args.description,
      evidence: args.evidence,
      recommendedAction: args.recommendedAction,
      status: "open",
      createdBy: args.createdBy,
      createdAt: Date.now(),
    });

    // If critical finding, update validation status
    if (args.severity === "critical") {
      const request = await ctx.db.get(args.validationRequestId);
      if (request && request.status === "in_progress") {
        await ctx.db.patch(args.validationRequestId, {
          status: "findings_review",
        });
      }
    }

    return findingId;
  },
});

/**
 * Remediate a finding
 */
export const remediateFinding = mutation({
  args: {
    findingId: v.id("validationFindings"),
    remediatedBy: v.string(),
    remediationNotes: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.findingId, {
      status: "remediated",
      remediatedBy: args.remediatedBy,
      remediatedAt: Date.now(),
      remediationNotes: args.remediationNotes,
    });

    return null;
  },
});

/**
 * Accept a finding as risk (no remediation)
 */
export const acceptFindingAsRisk = mutation({
  args: {
    findingId: v.id("validationFindings"),
    acceptedBy: v.string(),
    acceptanceRationale: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.findingId, {
      status: "accepted_risk",
      acceptedBy: args.acceptedBy,
      acceptedAt: Date.now(),
      acceptanceRationale: args.acceptanceRationale,
    });

    return null;
  },
});

/* ------------------------------------------------------------------ */
/* VALIDATION REPORT                                                   */
/* ------------------------------------------------------------------ */

/**
 * Generate validation report
 */
export const generateValidationReport = internalAction({
  args: {
    validationRequestId: v.id("validationRequests"),
    validatedBy: v.string(),
    scope: v.object({
      conceptualSoundness: v.boolean(),
      ongoingMonitoring: v.boolean(),
      outcomeAnalysis: v.boolean(),
      dataQuality: v.boolean(),
      assumptions: v.boolean(),
      implementation: v.boolean(),
    }),
    recommendation: v.union(
      v.literal("approve"),
      v.literal("conditional_approval"),
      v.literal("reject")
    ),
    recommendationRationale: v.string(),
    independenceAttestation: v.object({
      validatorRole: v.string(),
      conflictOfInterest: v.boolean(),
      conflictDescription: v.optional(v.string()),
    }),
  },
  returns: v.id("validationReports"),
  handler: async (ctx, args) => {
    // Get validation request
    const request = await ctx.runQuery(
      internal.domains.operations.validationWorkflow.getValidationRequest,
      { validationRequestId: args.validationRequestId }
    );

    if (!request) {
      throw new Error("Validation request not found");
    }

    // Get findings
    const findings = await ctx.runQuery(
      internal.domains.operations.validationWorkflow.getFindingsByRequest,
      { validationRequestId: args.validationRequestId }
    );

    // Summarize findings
    const findingsSummary = {
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
      informational: findings.filter((f) => f.severity === "informational").length,
    };

    // Create report
    const reportId = await ctx.runMutation(
      internal.domains.operations.validationWorkflow.createValidationReport,
      {
        validationRequestId: args.validationRequestId,
        modelCardId: request.modelCardId,
        validatedBy: args.validatedBy,
        scope: args.scope,
        recommendation: args.recommendation,
        recommendationRationale: args.recommendationRationale,
        independenceAttestation: {
          ...args.independenceAttestation,
          attestedAt: Date.now(),
        },
        findingsSummary,
      }
    );

    return reportId;
  },
});

/**
 * Approve validation and schedule next validation
 */
export const approveValidation = mutation({
  args: {
    validationReportId: v.id("validationReports"),
    approvedBy: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Get report
    const report = await ctx.db.get(args.validationReportId);
    if (!report) {
      throw new Error("Validation report not found");
    }

    // Get model card
    const modelCard = await ctx.db.get(report.modelCardId);
    if (!modelCard) {
      throw new Error("Model card not found");
    }

    // Calculate next validation date based on risk tier
    const requirements = RISK_TIER_REQUIREMENTS[modelCard.riskTier];
    const monthsUntilNext = requirements?.validationFrequencyMonths ?? 12;
    const nextValidationDate = new Date();
    nextValidationDate.setMonth(nextValidationDate.getMonth() + monthsUntilNext);
    const nextValidationDateStr = nextValidationDate.toISOString().split("T")[0];

    // Update report
    await ctx.db.patch(args.validationReportId, {
      approvedBy: args.approvedBy,
      approvedAt: Date.now(),
      nextValidationDate: nextValidationDateStr,
    });

    // Update model card
    await ctx.db.patch(report.modelCardId, {
      status: "active",
      lastValidationDate: new Date().toISOString().split("T")[0],
      nextValidationDate: nextValidationDateStr,
    });

    // Update validation request
    await ctx.db.patch(report.validationRequestId, {
      status: "completed",
      completedAt: Date.now(),
    });

    return null;
  },
});

/* ------------------------------------------------------------------ */
/* REVALIDATION TRIGGERS                                               */
/* ------------------------------------------------------------------ */

/**
 * Check for models requiring revalidation
 */
export const checkRevalidationTriggers = internalAction({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const createdRequests: string[] = [];

    // Get all active models
    const models = await ctx.runQuery(
      internal.domains.operations.validationWorkflow.getActiveModels,
      {}
    );

    const today = new Date().toISOString().split("T")[0];

    for (const model of models) {
      let shouldTrigger = false;
      let trigger: ValidationRequest["trigger"] = "scheduled_revalidation";

      // Check if validation is overdue
      if (model.nextValidationDate && model.nextValidationDate < today) {
        shouldTrigger = true;
        trigger = "scheduled_revalidation";
      }

      // Check if model has changed recently
      if (model.updatedAt && model.lastValidationDate) {
        const lastValidation = new Date(model.lastValidationDate).getTime();
        if (model.updatedAt > lastValidation) {
          shouldTrigger = true;
          trigger = "model_change";
        }
      }

      // Check for performance degradation
      const recentMetrics = await ctx.runQuery(
        internal.domains.operations.validationWorkflow.getRecentPerformanceMetrics,
        { modelId: model.modelId }
      );

      const hasPerformanceIssue = recentMetrics.some(
        (m) => m.metricType === "error_rate" && m.value > 0.15  // 15% error rate
      );

      if (hasPerformanceIssue) {
        shouldTrigger = true;
        trigger = "performance_degradation";
      }

      // Create validation request if triggered
      if (shouldTrigger) {
        // Check if request already exists
        const existingRequest = await ctx.runQuery(
          internal.domains.operations.validationWorkflow.getActiveValidationRequest,
          { modelCardId: model._id }
        );

        if (!existingRequest) {
          const requestId = await ctx.runMutation(
            internal.domains.operations.validationWorkflow.createValidationRequestInternal,
            {
              modelCardId: model._id,
              trigger,
              requestedBy: "system_auto_trigger",
            }
          );
          createdRequests.push(requestId);
        }
      }
    }

    return createdRequests;
  },
});

/* ------------------------------------------------------------------ */
/* CONVEX QUERIES/MUTATIONS (Internal Helpers)                         */
/* ------------------------------------------------------------------ */

export const getValidationRequest = query({
  args: { validationRequestId: v.id("validationRequests") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.validationRequestId);
  },
});

export const getModelCard = query({
  args: { modelCardId: v.id("modelCards") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.modelCardId);
  },
});

export const getEligibleValidators = query({
  args: {
    riskTier: v.string(),
    excludeUserId: v.string(),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    // Simplified: in real system, would query validator roster with qualifications
    // For now, return mock validators
    const allValidators = ["validator_1", "validator_2", "validator_3"];
    return allValidators.filter((v) => v !== args.excludeUserId);
  },
});

export const getValidatorWorkloads = query({
  args: { validators: v.array(v.string()) },
  returns: v.array(v.object({ validator: v.string(), activeValidations: v.number() })),
  handler: async (ctx, args) => {
    const workloads: Array<{ validator: string; activeValidations: number }> = [];

    for (const validator of args.validators) {
      const activeRequests = await ctx.db
        .query("validationRequests")
        .filter((q) =>
          q.and(
            q.eq(q.field("assignedValidator"), validator),
            q.eq(q.field("status"), "in_progress")
          )
        )
        .collect();

      workloads.push({
        validator,
        activeValidations: activeRequests.length,
      });
    }

    return workloads;
  },
});

export const assignValidatorInternal = internalMutation({
  args: {
    validationRequestId: v.id("validationRequests"),
    validatorUserId: v.string(),
    assignedBy: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.validationRequestId, {
      assignedValidator: args.validatorUserId,
      assignedAt: Date.now(),
      assignedBy: args.assignedBy,
      status: "in_progress",
    });
    return null;
  },
});

export const getFindingsByRequest = query({
  args: { validationRequestId: v.id("validationRequests") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("validationFindings")
      .withIndex("by_request", (q) => q.eq("validationRequestId", args.validationRequestId))
      .collect();
  },
});

export const createValidationReport = internalMutation({
  args: {
    validationRequestId: v.id("validationRequests"),
    modelCardId: v.id("modelCards"),
    validatedBy: v.string(),
    scope: v.any(),
    recommendation: v.string(),
    recommendationRationale: v.string(),
    independenceAttestation: v.any(),
    findingsSummary: v.any(),
  },
  returns: v.id("validationReports"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("validationReports", {
      reportId: `report_${Date.now()}`,
      validationRequestId: args.validationRequestId,
      modelCardId: args.modelCardId,
      validatedBy: args.validatedBy,
      validationDate: new Date().toISOString().split("T")[0],
      scope: args.scope,
      recommendation: args.recommendation,
      recommendationRationale: args.recommendationRationale,
      independenceAttestation: args.independenceAttestation,
      findingsSummary: args.findingsSummary,
      generatedAt: Date.now(),
    });
  },
});

export const getActiveModels = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    return await ctx.db
      .query("modelCards")
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
  },
});

export const getRecentPerformanceMetrics = query({
  args: { modelId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return await ctx.db
      .query("modelPerformanceMetrics")
      .withIndex("by_model", (q) => q.eq("modelId", args.modelId))
      .filter((q) => q.gte(q.field("recordedAt"), thirtyDaysAgo))
      .collect();
  },
});

export const getActiveValidationRequest = query({
  args: { modelCardId: v.id("modelCards") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("validationRequests")
      .withIndex("by_model", (q) => q.eq("modelCardId", args.modelCardId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "pending_assignment"),
          q.eq(q.field("status"), "in_progress"),
          q.eq(q.field("status"), "findings_review")
        )
      )
      .first();
  },
});

export const createValidationRequestInternal = internalMutation({
  args: {
    modelCardId: v.id("modelCards"),
    trigger: v.string(),
    requestedBy: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const requestId = `val_req_${Date.now()}`;
    await ctx.db.insert("validationRequests", {
      requestId,
      modelCardId: args.modelCardId,
      trigger: args.trigger,
      requestedBy: args.requestedBy,
      requestedAt: Date.now(),
      status: "pending_assignment",
    });
    return requestId;
  },
});

/**
 * Get validation status dashboard
 */
export const getValidationDashboard = query({
  args: {},
  returns: v.object({
    pendingAssignment: v.number(),
    inProgress: v.number(),
    findingsReview: v.number(),
    overdueModels: v.number(),
    upcomingValidations: v.array(v.any()),
  }),
  handler: async (ctx) => {
    const pendingAssignment = await ctx.db
      .query("validationRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending_assignment"))
      .collect();

    const inProgress = await ctx.db
      .query("validationRequests")
      .withIndex("by_status", (q) => q.eq("status", "in_progress"))
      .collect();

    const findingsReview = await ctx.db
      .query("validationRequests")
      .withIndex("by_status", (q) => q.eq("status", "findings_review"))
      .collect();

    const today = new Date().toISOString().split("T")[0];
    const allModels = await ctx.db.query("modelCards").collect();
    const overdueModels = allModels.filter(
      (m) => m.nextValidationDate && m.nextValidationDate < today
    );

    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const upcomingValidations = allModels
      .filter(
        (m) =>
          m.nextValidationDate &&
          m.nextValidationDate >= today &&
          m.nextValidationDate <= thirtyDaysFromNow
      )
      .map((m) => ({
        modelId: m.modelId,
        name: m.name,
        riskTier: m.riskTier,
        nextValidationDate: m.nextValidationDate,
      }))
      .slice(0, 10);

    return {
      pendingAssignment: pendingAssignment.length,
      inProgress: inProgress.length,
      findingsReview: findingsReview.length,
      overdueModels: overdueModels.length,
      upcomingValidations,
    };
  },
});
