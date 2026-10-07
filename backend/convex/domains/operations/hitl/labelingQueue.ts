// convex/domains/hitl/labelingQueue.ts
// HITL Labeling Queue Workflow
//
// Converts sourceQualityLog, verificationAuditLog, inconclusiveEventLog entries
// into labeled ground truth with inter-rater reliability measurement.
//
// Implements stratified sampling, SLA tracking, and Cohen's kappa computation.
//
// ============================================================================

import { v } from "convex/values";
import { internalAction, internalMutation, mutation, query } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* TASK CREATION                                                       */
/* ------------------------------------------------------------------ */

/**
 * Create labeling task from source quality log entry
 */
export const createLabelingTaskFromSourceQuality = internalMutation({
  args: {
    sourceQualityLogId: v.id("sourceQualityLog"),
    stratum: v.string(),
    priority: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low")
    ),
    costWeight: v.optional(v.number()),
    slaHours: v.optional(v.number()),
  },
  returns: v.id("labelingTasks"),
  handler: async (ctx, args) => {
    const sourceLog = await ctx.db.get(args.sourceQualityLogId);
    if (!sourceLog) {
      throw new Error("Source quality log not found");
    }

    // Check if task already exists
    const existing = await ctx.db
      .query("labelingTasks")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", "source_quality").eq("sourceRecordId", args.sourceQualityLogId)
      )
      .first();

    if (existing) {
      return existing._id;
    }

    const now = Date.now();
    const slaHours = args.slaHours ?? 48;

    const taskId = `task_sq_${args.sourceQualityLogId}_${Date.now()}`;

    return await ctx.db.insert("labelingTasks", {
      taskId,
      sourceType: "source_quality",
      sourceRecordId: args.sourceQualityLogId,
      stratum: args.stratum,
      sourceTier: sourceLog.tier,
      confidenceBucket: sourceLog.confidence > 80 ? "high" : sourceLog.confidence > 50 ? "medium" : "low",
      costWeight: args.costWeight ?? 1.0,
      contextData: {
        url: sourceLog.url,
        domain: sourceLog.domain,
        tier: sourceLog.tier,
        score: sourceLog.score,
        confidence: sourceLog.confidence,
        scoreBreakdown: sourceLog.scoreBreakdown,
      },
      status: "pending",
      priority: args.priority,
      slaDeadline: now + slaHours * 60 * 60 * 1000,
      agingWarningThreshold: now + (slaHours * 0.75) * 60 * 60 * 1000,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Create labeling task from inconclusive event
 */
export const createLabelingTaskFromInconclusiveEvent = internalMutation({
  args: {
    inconclusiveEventId: v.id("inconclusiveEventLog"),
    stratum: v.string(),
    priority: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low")
    ),
    costWeight: v.optional(v.number()),
  },
  returns: v.id("labelingTasks"),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.inconclusiveEventId);
    if (!event) {
      throw new Error("Inconclusive event not found");
    }

    // Check if task already exists
    const existing = await ctx.db
      .query("labelingTasks")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", "inconclusive_event").eq("sourceRecordId", args.inconclusiveEventId)
      )
      .first();

    if (existing) {
      return existing._id;
    }

    const now = Date.now();

    const taskId = `task_ie_${args.inconclusiveEventId}_${Date.now()}`;

    return await ctx.db.insert("labelingTasks", {
      taskId,
      sourceType: "inconclusive_event",
      sourceRecordId: args.inconclusiveEventId,
      stratum: args.stratum,
      dependency: event.dependency,
      costWeight: args.costWeight ?? 1.0,
      contextData: {
        dependency: event.dependency,
        failureMode: event.failureMode,
        operation: event.operation,
        impactScope: event.impactScope,
      },
      status: "pending",
      priority: args.priority,
      slaDeadline: now + 72 * 60 * 60 * 1000, // 72h for inconclusive
      agingWarningThreshold: now + 54 * 60 * 60 * 1000,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/* ------------------------------------------------------------------ */
/* TASK ASSIGNMENT                                                     */
/* ------------------------------------------------------------------ */

/**
 * Get pending tasks for labeling queue view
 */
export const getPendingLabelingTasks = query({
  args: {
    stratum: v.optional(v.string()),
    priority: v.optional(v.string()),
    sourceType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("labelingTasks")
      .withIndex("by_status_priority", (q) => q.eq("status", "pending"));

    const tasks = await query.order("desc").take(args.limit ?? 100);

    // Filter by optional params
    let filtered = tasks;
    if (args.stratum) {
      filtered = filtered.filter((t) => t.stratum === args.stratum);
    }
    if (args.priority) {
      filtered = filtered.filter((t) => t.priority === args.priority);
    }
    if (args.sourceType) {
      filtered = filtered.filter((t) => t.sourceType === args.sourceType);
    }

    return filtered;
  },
});

/**
 * Assign task to labeler
 */
export const assignLabelingTask = mutation({
  args: {
    taskId: v.id("labelingTasks"),
    assignedTo: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    if (task.status !== "pending") {
      throw new Error("Task already assigned or completed");
    }

    await ctx.db.patch(args.taskId, {
      assignedTo: args.assignedTo,
      assignedAt: Date.now(),
      status: "assigned",
      updatedAt: Date.now(),
    });

    return null;
  },
});

/* ------------------------------------------------------------------ */
/* LABEL SUBMISSION                                                    */
/* ------------------------------------------------------------------ */

/**
 * Submit a label for a task
 */
export const submitLabel = mutation({
  args: {
    taskId: v.id("labelingTasks"),
    labeledBy: v.string(),
    label: v.string(),
    confidence: v.number(),
    shortRationale: v.string(),
    evidenceArtifactIds: v.array(v.id("sourceArtifacts")),
    evidenceUrls: v.optional(v.array(v.string())),
    policyTags: v.array(v.string()),
    pivotEvidence: v.optional(v.string()),
    suggestedRuleChanges: v.optional(v.array(v.any())),
    timeSpentSeconds: v.optional(v.number()),
  },
  returns: v.object({
    labelId: v.id("labels"),
    rationaleId: v.id("labelRationales"),
  }),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    const now = Date.now();

    // Create rationale first
    const rationaleId = `rationale_${args.taskId}_${args.labeledBy}_${now}`;
    const rationaleDbId = await ctx.db.insert("labelRationales", {
      rationaleId,
      evidenceArtifactIds: args.evidenceArtifactIds,
      evidenceUrls: args.evidenceUrls,
      shortRationale: args.shortRationale,
      policyTags: args.policyTags,
      pivotEvidence: args.pivotEvidence,
      suggestedRuleChanges: args.suggestedRuleChanges,
      createdAt: now,
    });

    // Create label
    const labelId = `label_${args.taskId}_${args.labeledBy}_${now}`;
    const labelDbId = await ctx.db.insert("labels", {
      labelId,
      taskId: args.taskId,
      sourceType: task.sourceType,
      sourceRecordId: task.sourceRecordId,
      labeledBy: args.labeledBy,
      labeledAt: now,
      label: args.label,
      confidence: args.confidence,
      rationaleId: rationaleDbId,
      timeSpentSeconds: args.timeSpentSeconds,
      createdAt: now,
    });

    // Link rationale to label
    await ctx.db.patch(rationaleDbId, {
      labelId: labelDbId,
    });

    // Check if multiple labels exist now (potential disagreement)
    const allLabels = await ctx.db
      .query("labels")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();

    if (allLabels.length >= 2) {
      // Check for disagreement
      const uniqueLabels = new Set(allLabels.map((l) => l.label));
      if (uniqueLabels.size > 1) {
        // Disagreement detected - create adjudication request
        await ctx.db.insert("adjudicationRequests", {
          adjudicationId: `adj_${args.taskId}_${now}`,
          taskId: args.taskId,
          sourceType: task.sourceType,
          sourceRecordId: task.sourceRecordId,
          reason: "disagreement",
          labelIds: allLabels.map((l) => l._id),
          costWeight: task.costWeight ?? 1.0,
          priority: task.priority,
          slaDeadline: now + 72 * 60 * 60 * 1000, // 72h for adjudication
          status: "pending",
          createdAt: now,
          updatedAt: now,
        });

        // Update task status
        await ctx.db.patch(args.taskId, {
          status: "escalated",
          updatedAt: now,
        });
      } else {
        // Agreement - mark task completed
        await ctx.db.patch(args.taskId, {
          status: "completed",
          updatedAt: now,
        });
      }
    } else {
      // First label - mark in progress
      await ctx.db.patch(args.taskId, {
        status: "in_progress",
        updatedAt: now,
      });
    }

    return {
      labelId: labelDbId,
      rationaleId: rationaleDbId,
    };
  },
});

/* ------------------------------------------------------------------ */
/* INTER-ANNOTATOR AGREEMENT COMPUTATION                               */
/* ------------------------------------------------------------------ */

/**
 * Compute Cohen's kappa for a stratum
 */
export const computeInterAnnotatorAgreement = internalAction({
  args: {
    stratum: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    minKappaThreshold: v.optional(v.number()),
  },
  returns: v.object({
    snapshotId: v.id("interAnnotatorAgreement"),
    cohensKappa: v.number(),
    percentAgreement: v.number(),
    passesThreshold: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const threshold = args.minKappaThreshold ?? 0.6; // "Substantial" agreement

    // Get all labels in time window for this stratum
    const tasks = await ctx.runQuery(async (ctx) => {
      return await ctx.db
        .query("labelingTasks")
        .withIndex("by_stratum", (q) => q.eq("stratum", args.stratum))
        .filter((q) =>
          q.and(
            q.gte(q.field("createdAt"), args.startDate),
            q.lte(q.field("createdAt"), args.endDate)
          )
        )
        .collect();
    });

    // Get all labels for these tasks
    const labelsByTask = new Map<string, any[]>();
    for (const task of tasks) {
      const labels = await ctx.runQuery(async (ctx) => {
        return await ctx.db
          .query("labels")
          .withIndex("by_task", (q) => q.eq("taskId", task._id))
          .collect();
      });
      if (labels.length >= 2) {
        labelsByTask.set(task._id, labels);
      }
    }

    // Compute agreement metrics
    let agreements = 0;
    let disagreements = 0;
    const confusionMatrix = new Map<string, Map<string, number>>();

    for (const [_taskId, labels] of labelsByTask) {
      // Compare all pairs
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const label1 = labels[i].label;
          const label2 = labels[j].label;

          if (label1 === label2) {
            agreements++;
          } else {
            disagreements++;
          }

          // Update confusion matrix
          if (!confusionMatrix.has(label1)) {
            confusionMatrix.set(label1, new Map());
          }
          const row = confusionMatrix.get(label1)!;
          row.set(label2, (row.get(label2) ?? 0) + 1);
        }
      }
    }

    const total = agreements + disagreements;
    const percentAgreement = total > 0 ? (agreements / total) * 100 : 0;

    // Cohen's kappa calculation
    // κ = (Po - Pe) / (1 - Pe)
    // Po = observed agreement
    // Pe = expected agreement by chance

    const Po = total > 0 ? agreements / total : 0;

    // Compute Pe (expected agreement)
    // For simplicity, assume uniform distribution
    const uniqueLabels = new Set<string>();
    for (const labels of labelsByTask.values()) {
      for (const label of labels) {
        uniqueLabels.add(label.label);
      }
    }
    const numLabels = uniqueLabels.size;
    const Pe = 1 / numLabels;

    const cohensKappa = (Po - Pe) / (1 - Pe);

    // Store snapshot
    const snapshotId = await ctx.runMutation(async (ctx) => {
      return await ctx.db.insert("interAnnotatorAgreement", {
        snapshotId: `iaa_${args.stratum}_${args.startDate}_${args.endDate}`,
        startDate: args.startDate,
        endDate: args.endDate,
        stratum: args.stratum,
        cohensKappa,
        percentAgreement,
        sampleSize: labelsByTask.size,
        confusionMatrix: Object.fromEntries(confusionMatrix),
        annotatorPairs: [], // Simplified for now
        passesKappaThreshold: cohensKappa >= threshold,
        threshold,
        computedAt: Date.now(),
      });
    });

    return {
      snapshotId,
      cohensKappa,
      percentAgreement,
      passesThreshold: cohensKappa >= threshold,
    };
  },
});

/* ------------------------------------------------------------------ */
/* DATASET PROMOTION GATES                                             */
/* ------------------------------------------------------------------ */

/**
 * Evaluate dataset promotion gates
 */
export const evaluateDatasetPromotionGates = internalAction({
  args: {
    datasetVersion: v.string(),
    minSampleSizePerStratum: v.any(), // Record<string, number>
    minKappa: v.number(),
    maxAdjudicationBacklog: v.number(),
  },
  returns: v.object({
    gateId: v.id("datasetPromotionGates"),
    allGatesPassed: v.boolean(),
    failures: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const failures: string[] = [];

    // Check sample size gate
    const actualSampleSize: Record<string, number> = {};
    let sampleSizeGatePassed = true;

    for (const [stratum, minSize] of Object.entries(args.minSampleSizePerStratum)) {
      const tasks = await ctx.runQuery(async (ctx) => {
        return await ctx.db
          .query("labelingTasks")
          .withIndex("by_stratum", (q) => q.eq("stratum", stratum).eq("status", "completed"))
          .collect();
      });

      actualSampleSize[stratum] = tasks.length;

      if (tasks.length < (minSize as number)) {
        sampleSizeGatePassed = false;
        failures.push(`Stratum ${stratum}: ${tasks.length} < ${minSize} samples`);
      }
    }

    // Check kappa gate
    const recentAgreements = await ctx.runQuery(async (ctx) => {
      return await ctx.db
        .query("interAnnotatorAgreement")
        .withIndex("by_computed", (q) => q.gte("computedAt", Date.now() - 30 * 24 * 60 * 60 * 1000))
        .collect();
    });

    const avgKappa =
      recentAgreements.length > 0
        ? recentAgreements.reduce((sum, a) => sum + a.cohensKappa, 0) / recentAgreements.length
        : 0;

    const kappaGatePassed = avgKappa >= args.minKappa;
    if (!kappaGatePassed) {
      failures.push(`Cohen's kappa ${avgKappa.toFixed(3)} < ${args.minKappa}`);
    }

    // Check adjudication backlog gate
    const backlog = await ctx.runQuery(async (ctx) => {
      return await ctx.db
        .query("adjudicationRequests")
        .withIndex("by_status_priority", (q) => q.eq("status", "pending"))
        .collect();
    });

    const backlogGatePassed = backlog.length <= args.maxAdjudicationBacklog;
    if (!backlogGatePassed) {
      failures.push(`Adjudication backlog ${backlog.length} > ${args.maxAdjudicationBacklog}`);
    }

    const allGatesPassed = sampleSizeGatePassed && kappaGatePassed && backlogGatePassed;

    // Store gate evaluation
    const gateId = await ctx.runMutation(async (ctx) => {
      return await ctx.db.insert("datasetPromotionGates", {
        gateId: `gate_${args.datasetVersion}_${Date.now()}`,
        datasetVersion: args.datasetVersion,
        minSampleSizePerStratum: args.minSampleSizePerStratum,
        actualSampleSize,
        sampleSizeGatePassed,
        minKappa: args.minKappa,
        actualKappa: avgKappa,
        kappaGatePassed,
        maxAdjudicationBacklog: args.maxAdjudicationBacklog,
        actualAdjudicationBacklog: backlog.length,
        backlogGatePassed,
        allGatesPassed,
        evaluatedAt: Date.now(),
        evaluatedBy: "system",
      });
    });

    return {
      gateId,
      allGatesPassed,
      failures,
    };
  },
});

/* ------------------------------------------------------------------ */
/* SLA MONITORING                                                      */
/* ------------------------------------------------------------------ */

/**
 * Get tasks approaching SLA deadline
 */
export const getTasksApproachingSla = query({
  args: {
    hoursUntilDeadline: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const hours = args.hoursUntilDeadline ?? 12;
    const threshold = Date.now() + hours * 60 * 60 * 1000;

    const tasks = await ctx.db
      .query("labelingTasks")
      .withIndex("by_sla", (q) => q.lte("slaDeadline", threshold))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "assigned"),
          q.eq(q.field("status"), "in_progress")
        )
      )
      .collect();

    return tasks;
  },
});

/**
 * Get overdue tasks
 */
export const getOverdueTasks = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const now = Date.now();

    const tasks = await ctx.db
      .query("labelingTasks")
      .withIndex("by_sla", (q) => q.lte("slaDeadline", now))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "assigned"),
          q.eq(q.field("status"), "in_progress")
        )
      )
      .collect();

    return tasks;
  },
});

/* ------------------------------------------------------------------ */
/* EXPORTS                                                             */
/* ------------------------------------------------------------------ */

// All functions exported inline
