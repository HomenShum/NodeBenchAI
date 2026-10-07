// convex/domains/hitl/adjudicationWorkflow.ts
// HITL Adjudication Workflow
//
// Resolves disagreements between labelers and escalates high-cost decisions
// with traceable reasoning and evidence binding.
//
// ============================================================================

import { v } from "convex/values";
import { internalMutation, mutation, query } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* ADJUDICATION QUEUE                                                  */
/* ------------------------------------------------------------------ */

/**
 * Get pending adjudication requests
 */
export const getPendingAdjudicationRequests = query({
  args: {
    priority: v.optional(v.string()),
    reason: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("adjudicationRequests")
      .withIndex("by_status_priority", (q) => q.eq("status", "pending"));

    const requests = await query.order("desc").take(args.limit ?? 100);

    // Filter by optional params
    let filtered = requests;
    if (args.priority) {
      filtered = filtered.filter((r) => r.priority === args.priority);
    }
    if (args.reason) {
      filtered = filtered.filter((r) => r.reason === args.reason);
    }

    return filtered;
  },
});

/**
 * Get adjudication request with full context
 */
export const getAdjudicationRequestWithContext = query({
  args: {
    adjudicationId: v.id("adjudicationRequests"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.adjudicationId);
    if (!request) {
      throw new Error("Adjudication request not found");
    }

    // Get task
    const task = await ctx.db.get(request.taskId);

    // Get all labels
    const labels = await Promise.all(
      request.labelIds.map(async (labelId) => {
        const label = await ctx.db.get(labelId);
        if (!label) return null;

        // Get rationale
        const rationale = await ctx.db.get(label.rationaleId);

        return {
          ...label,
          rationale,
        };
      })
    );

    return {
      request,
      task,
      labels: labels.filter((l) => l !== null),
    };
  },
});

/**
 * Assign adjudication request to adjudicator
 */
export const assignAdjudicationRequest = mutation({
  args: {
    adjudicationId: v.id("adjudicationRequests"),
    adjudicatorId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.adjudicationId);
    if (!request) {
      throw new Error("Adjudication request not found");
    }

    if (request.status !== "pending") {
      throw new Error("Adjudication request already assigned or resolved");
    }

    await ctx.db.patch(args.adjudicationId, {
      assignedAdjudicator: args.adjudicatorId,
      assignedAt: Date.now(),
      status: "in_progress",
      updatedAt: Date.now(),
    });

    return null;
  },
});

/* ------------------------------------------------------------------ */
/* DECISION SUBMISSION                                                 */
/* ------------------------------------------------------------------ */

/**
 * Submit adjudication decision
 */
export const submitAdjudicationDecision = mutation({
  args: {
    adjudicationId: v.id("adjudicationRequests"),
    adjudicatorId: v.string(),
    finalLabel: v.string(),
    confidence: v.number(),
    agreedWithLabelId: v.optional(v.id("labels")),
    synthesizedNewLabel: v.optional(v.boolean()),
    reasoning: v.string(),
    evidenceArtifactIds: v.array(v.id("sourceArtifacts")),
    policyInterpretation: v.optional(v.string()),
    suggestedRuleChanges: v.optional(v.array(v.any())),
  },
  returns: v.id("adjudicationDecisions"),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.adjudicationId);
    if (!request) {
      throw new Error("Adjudication request not found");
    }

    if (request.status !== "in_progress") {
      throw new Error("Adjudication request not in progress");
    }

    // Compute evidence content hashes
    const evidenceContentHashes: string[] = [];
    for (const artifactId of args.evidenceArtifactIds) {
      const artifact = await ctx.db.get(artifactId);
      if (artifact && artifact.contentHash) {
        evidenceContentHashes.push(artifact.contentHash);
      }
    }

    const now = Date.now();

    // Create decision
    const decisionId = `decision_${args.adjudicationId}_${now}`;
    const decisionDbId = await ctx.db.insert("adjudicationDecisions", {
      decisionId,
      adjudicationId: args.adjudicationId,
      finalLabel: args.finalLabel,
      confidence: args.confidence,
      decision: {
        agreedWithLabelId: args.agreedWithLabelId,
        synthesizedNewLabel: args.synthesizedNewLabel ?? false,
        reasoning: args.reasoning,
        evidenceReferences: args.evidenceArtifactIds,
        policyInterpretation: args.policyInterpretation,
      },
      suggestedRuleChanges: args.suggestedRuleChanges,
      adjudicatorId: args.adjudicatorId,
      decidedAt: now,
      evidenceBindingComplete: args.evidenceArtifactIds.length > 0,
      evidenceArtifactIds: args.evidenceArtifactIds,
      evidenceContentHashes,
      createdAt: now,
    });

    // Update request status
    await ctx.db.patch(args.adjudicationId, {
      status: "resolved",
      updatedAt: now,
    });

    // Update task status
    await ctx.db.patch(request.taskId, {
      status: "completed",
      updatedAt: now,
    });

    // If rule changes suggested, create calibration proposal
    if (args.suggestedRuleChanges && args.suggestedRuleChanges.length > 0) {
      // This would trigger calibration workflow
      // For now, just log
      console.log("Rule changes suggested from adjudication:", args.suggestedRuleChanges);
    }

    return decisionDbId;
  },
});

/* ------------------------------------------------------------------ */
/* DISAGREEMENT ANALYSIS                                               */
/* ------------------------------------------------------------------ */

/**
 * Analyze disagreement patterns
 */
export const analyzeDisagreementPatterns = query({
  args: {
    startDate: v.number(),
    endDate: v.number(),
    stratum: v.optional(v.string()),
  },
  returns: v.object({
    totalDisagreements: v.number(),
    disagreementRate: v.number(),
    byReason: v.any(),
    byStratum: v.any(),
    topPolicyTags: v.array(v.object({
      tag: v.string(),
      count: v.number(),
    })),
  }),
  handler: async (ctx, args) => {
    // Get all adjudication requests in time window
    const requests = await ctx.db
      .query("adjudicationRequests")
      .filter((q) =>
        q.and(
          q.gte(q.field("createdAt"), args.startDate),
          q.lte(q.field("createdAt"), args.endDate)
        )
      )
      .collect();

    let filtered = requests;
    if (args.stratum) {
      const tasks = await Promise.all(
        requests.map(async (r) => {
          const task = await ctx.db.get(r.taskId);
          return { request: r, task };
        })
      );
      filtered = tasks
        .filter((t) => t.task?.stratum === args.stratum)
        .map((t) => t.request);
    }

    const totalDisagreements = filtered.length;

    // Group by reason
    const byReason: Record<string, number> = {};
    for (const req of filtered) {
      byReason[req.reason] = (byReason[req.reason] ?? 0) + 1;
    }

    // Group by stratum
    const byStratum: Record<string, number> = {};
    for (const req of filtered) {
      const task = await ctx.db.get(req.taskId);
      if (task) {
        byStratum[task.stratum] = (byStratum[task.stratum] ?? 0) + 1;
      }
    }

    // Get total tasks for rate calculation
    const allTasks = await ctx.db
      .query("labelingTasks")
      .filter((q) =>
        q.and(
          q.gte(q.field("createdAt"), args.startDate),
          q.lte(q.field("createdAt"), args.endDate)
        )
      )
      .collect();

    const disagreementRate = allTasks.length > 0 ? (totalDisagreements / allTasks.length) * 100 : 0;

    // Analyze policy tags from decisions
    const policyTagCounts = new Map<string, number>();
    for (const req of filtered) {
      if (req.status === "resolved") {
        const decision = await ctx.db
          .query("adjudicationDecisions")
          .withIndex("by_adjudication", (q) => q.eq("adjudicationId", req._id))
          .first();

        if (decision && decision.suggestedRuleChanges) {
          for (const change of decision.suggestedRuleChanges) {
            if (change.changeType) {
              policyTagCounts.set(
                change.changeType,
                (policyTagCounts.get(change.changeType) ?? 0) + 1
              );
            }
          }
        }
      }
    }

    const topPolicyTags = Array.from(policyTagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalDisagreements,
      disagreementRate,
      byReason,
      byStratum,
      topPolicyTags,
    };
  },
});

/* ------------------------------------------------------------------ */
/* SLA MONITORING FOR ADJUDICATIONS                                    */
/* ------------------------------------------------------------------ */

/**
 * Get adjudication requests approaching SLA
 */
export const getAdjudicationsApproachingSla = query({
  args: {
    hoursUntilDeadline: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const hours = args.hoursUntilDeadline ?? 24;
    const threshold = Date.now() + hours * 60 * 60 * 1000;

    const requests = await ctx.db
      .query("adjudicationRequests")
      .withIndex("by_sla", (q) => q.lte("slaDeadline", threshold))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "in_progress")
        )
      )
      .collect();

    return requests;
  },
});

/**
 * Get overdue adjudication requests
 */
export const getOverdueAdjudications = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const now = Date.now();

    const requests = await ctx.db
      .query("adjudicationRequests")
      .withIndex("by_sla", (q) => q.lte("slaDeadline", now))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "in_progress")
        )
      )
      .collect();

    return requests;
  },
});

/* ------------------------------------------------------------------ */
/* ADJUDICATOR WORKLOAD BALANCING                                      */
/* ------------------------------------------------------------------ */

/**
 * Get adjudicator workloads
 */
export const getAdjudicatorWorkloads = query({
  args: {
    adjudicators: v.array(v.string()),
  },
  returns: v.array(v.object({
    adjudicator: v.string(),
    activeAdjudications: v.number(),
    resolvedLast7Days: v.number(),
    avgResolutionTimeHours: v.number(),
  })),
  handler: async (ctx, args) => {
    const workloads: Array<{
      adjudicator: string;
      activeAdjudications: number;
      resolvedLast7Days: number;
      avgResolutionTimeHours: number;
    }> = [];
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const adjudicator of args.adjudicators) {
      // Active adjudications
      const active = await ctx.db
        .query("adjudicationRequests")
        .withIndex("by_adjudicator", (q) =>
          q.eq("assignedAdjudicator", adjudicator).eq("status", "in_progress")
        )
        .collect();

      // Resolved in last 7 days
      const resolved = await ctx.db
        .query("adjudicationRequests")
        .withIndex("by_adjudicator", (q) =>
          q.eq("assignedAdjudicator", adjudicator).eq("status", "resolved")
        )
        .filter((q) => q.gte(q.field("updatedAt"), sevenDaysAgo))
        .collect();

      // Calculate avg resolution time
      let totalResolutionTime = 0;
      for (const req of resolved) {
        if (req.assignedAt && req.updatedAt) {
          totalResolutionTime += req.updatedAt - req.assignedAt;
        }
      }

      const avgResolutionTimeHours =
        resolved.length > 0
          ? totalResolutionTime / resolved.length / (60 * 60 * 1000)
          : 0;

      workloads.push({
        adjudicator,
        activeAdjudications: active.length,
        resolvedLast7Days: resolved.length,
        avgResolutionTimeHours,
      });
    }

    return workloads;
  },
});

/**
 * Suggest next adjudicator for assignment (load balancing)
 */
export const suggestAdjudicator = query({
  args: {
    eligibleAdjudicators: v.array(v.string()),
  },
  returns: v.object({
    suggestedAdjudicator: v.string(),
    reason: v.string(),
  }),
  handler: async (ctx, args) => {
    const workloads = await ctx.db
      .query("adjudicationRequests")
      .withIndex("by_adjudicator", (q) => q.eq("status", "in_progress"))
      .collect();

    // Count active per adjudicator
    const activeCounts = new Map<string, number>();
    for (const adjudicator of args.eligibleAdjudicators) {
      activeCounts.set(adjudicator, 0);
    }

    for (const req of workloads) {
      if (req.assignedAdjudicator && activeCounts.has(req.assignedAdjudicator)) {
        activeCounts.set(
          req.assignedAdjudicator,
          (activeCounts.get(req.assignedAdjudicator) ?? 0) + 1
        );
      }
    }

    // Find adjudicator with fewest active
    let minAdjudicator = args.eligibleAdjudicators[0];
    let minCount = activeCounts.get(minAdjudicator) ?? 0;

    for (const [adjudicator, count] of activeCounts.entries()) {
      if (count < minCount) {
        minAdjudicator = adjudicator;
        minCount = count;
      }
    }

    return {
      suggestedAdjudicator: minAdjudicator,
      reason: `Lowest active workload (${minCount} active adjudications)`,
    };
  },
});

/* ------------------------------------------------------------------ */
/* RULE CHANGE AGGREGATION                                             */
/* ------------------------------------------------------------------ */

/**
 * Aggregate rule change suggestions from adjudications
 */
export const aggregateRuleChangeSuggestions = query({
  args: {
    startDate: v.number(),
    endDate: v.number(),
    minOccurrences: v.optional(v.number()),
  },
  returns: v.array(v.object({
    ruleId: v.string(),
    changeType: v.string(),
    occurrences: v.number(),
    proposals: v.array(v.string()),
    avgConfidence: v.number(),
  })),
  handler: async (ctx, args) => {
    const minOccurrences = args.minOccurrences ?? 3;

    // Get all decisions in time window
    const decisions = await ctx.db
      .query("adjudicationDecisions")
      .withIndex("by_decided", (q) =>
        q.gte("decidedAt", args.startDate).lte("decidedAt", args.endDate)
      )
      .collect();

    // Aggregate by ruleId + changeType
    const aggregates = new Map<string, {
      ruleId: string;
      changeType: string;
      occurrences: number;
      proposals: string[];
      confidences: number[];
    }>();

    for (const decision of decisions) {
      if (decision.suggestedRuleChanges) {
        for (const change of decision.suggestedRuleChanges) {
          const key = `${change.ruleId}_${change.changeType}`;

          if (!aggregates.has(key)) {
            aggregates.set(key, {
              ruleId: change.ruleId,
              changeType: change.changeType,
              occurrences: 0,
              proposals: [],
              confidences: [],
            });
          }

          const agg = aggregates.get(key)!;
          agg.occurrences++;
          agg.proposals.push(change.proposal);
          agg.confidences.push(decision.confidence);
        }
      }
    }

    // Filter by min occurrences and compute avg confidence
    const results: Array<{
      ruleId: string;
      changeType: string;
      occurrences: number;
      proposals: string[];
      avgConfidence: number;
    }> = [];
    for (const agg of aggregates.values()) {
      if (agg.occurrences >= minOccurrences) {
        const avgConfidence =
          agg.confidences.reduce((sum, c) => sum + c, 0) / agg.confidences.length;

        results.push({
          ruleId: agg.ruleId,
          changeType: agg.changeType,
          occurrences: agg.occurrences,
          proposals: agg.proposals,
          avgConfidence,
        });
      }
    }

    // Sort by occurrences
    results.sort((a, b) => b.occurrences - a.occurrences);

    return results;
  },
});

/* ------------------------------------------------------------------ */
/* EXPORTS                                                             */
/* ------------------------------------------------------------------ */

// All functions exported inline
