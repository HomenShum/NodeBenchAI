/**
 * Mission Orchestrator — planner → worker → judge → merge flow
 *
 * Implements the hierarchical multi-agent harness described in v2 plan
 * sections 4, 5, and 6. This is the core execution engine for NodeBench.
 *
 * Anti-flat-coordination rules enforced:
 * - Every subtask has one owner, one bounded input, one output contract
 * - Every subtask has one judge gate and one merge boundary
 * - Merges happen ONLY after verification
 * - "Done" requires post-execution review
 *
 * Verifiability tiers:
 * - Tier 1: Machine-checkable (compile, test, schema validate)
 * - Tier 2: Expert-checkable (strategy, investigation, causal)
 * - Tier 3: Human-sniff-check required (irreversible, sensitive)
 */

import { v } from "convex/values";
import { mutation, query, action } from "../../_generated/server";
import { api } from "../../_generated/api";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getMission = query({
  args: { missionId: v.id("missions") },
  handler: async (ctx, { missionId }) => {
    return ctx.db.get(missionId);
  },
});

export const getMissionByKey = query({
  args: { missionKey: v.string() },
  handler: async (ctx, { missionKey }) => {
    return ctx.db
      .query("missions")
      .withIndex("by_mission_key", (q) => q.eq("missionKey", missionKey))
      .first();
  },
});

/** BOUND: Max tasks per mission query */
const MAX_TASKS_PER_MISSION = 500;

export const getTasksForMission = query({
  args: { missionId: v.id("missions") },
  handler: async (ctx, { missionId }) => {
    return ctx.db
      .query("taskPlans")
      .withIndex("by_mission_order", (q) => q.eq("missionId", missionId))
      .take(MAX_TASKS_PER_MISSION);
  },
});

export const getPendingSniffChecks = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("sniffChecks")
      .withIndex("by_status_created", (q) => q.eq("status", "pending"))
      .order("desc")
      .take(50);
  },
});

export const getJudgeReviewsForMission = query({
  args: { missionId: v.id("missions") },
  handler: async (ctx, { missionId }) => {
    return ctx.db
      .query("judgeReviews")
      .withIndex("by_mission_verdict", (q) => q.eq("missionId", missionId))
      .take(MAX_TASKS_PER_MISSION);
  },
});

export const getMissionJudgmentSummary = query({
  args: { missionId: v.id("missions") },
  handler: async (ctx, { missionId }) => {
    const [latestGate, latestDecisionMemory, latestPassport] = await Promise.all([
      ctx.db
        .query("preExecutionGates")
        .withIndex("by_mission", (q) => q.eq("missionId", missionId))
        .order("desc")
        .first(),
      ctx.db
        .query("decisionMemory")
        .withIndex("by_source_mission", (q) => q.eq("sourceMissionId", missionId))
        .order("desc")
        .first(),
      ctx.db
        .query("passportEnforcementLogs")
        .withIndex("by_mission", (q) => q.eq("missionId", missionId))
        .order("desc")
        .first(),
    ]);

    return {
      latestGate: latestGate
        ? {
            decision: latestGate.decision,
            gatesPassed: latestGate.gatesPassed,
            disqualifiersTriggered: latestGate.disqualifiersTriggered,
            reasoning: latestGate.reasoning,
            createdAt: latestGate.createdAt,
          }
        : null,
      latestDecisionMemory: latestDecisionMemory
        ? {
            verdict: latestDecisionMemory.verdict,
            confidence: latestDecisionMemory.confidence,
            reasoning: latestDecisionMemory.reasoning,
            createdAt: latestDecisionMemory.createdAt,
          }
        : null,
      latestPassport: latestPassport
        ? {
            decision: latestPassport.decision,
            toolName: latestPassport.toolName,
            reason: latestPassport.reason,
            createdAt: latestPassport.createdAt,
          }
        : null,
    };
  },
});

export const getMissionDashboard = query({
  args: {},
  handler: async (ctx) => {
    const active = await ctx.db
      .query("missions")
      .withIndex("by_status_updated", (q) => q.eq("status", "executing"))
      .order("desc")
      .take(20);

    const judging = await ctx.db
      .query("missions")
      .withIndex("by_status_updated", (q) => q.eq("status", "judging"))
      .order("desc")
      .take(10);

    const sniffCheck = await ctx.db
      .query("missions")
      .withIndex("by_status_updated", (q) => q.eq("status", "sniff_check"))
      .order("desc")
      .take(10);

    const recentCompleted = await ctx.db
      .query("missions")
      .withIndex("by_status_updated", (q) => q.eq("status", "completed"))
      .order("desc")
      .take(10);

    const pendingSniffChecks = await ctx.db
      .query("sniffChecks")
      .withIndex("by_status_created", (q) => q.eq("status", "pending"))
      .order("desc")
      .take(20);

    return {
      active,
      judging,
      sniffCheck,
      recentCompleted,
      pendingSniffChecks,
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations — Mission lifecycle
// ---------------------------------------------------------------------------

export const createMission = mutation({
  args: {
    missionKey: v.string(),
    title: v.string(),
    description: v.string(),
    missionType: v.union(
      v.literal("investigation"),
      v.literal("company_direction"),
      v.literal("repo_shift"),
      v.literal("document_enrichment"),
      v.literal("app_building"),
      v.literal("operational_monitor"),
      v.literal("custom"),
    ),
    successCriteria: v.array(v.object({
      criterion: v.string(),
      verifiabilityTier: v.union(
        v.literal("machine_checkable"),
        v.literal("expert_checkable"),
        v.literal("human_sniff_check"),
      ),
    })),
    outputContract: v.optional(v.object({
      requiredArtifacts: v.array(v.string()),
      requiredEvidenceCount: v.optional(v.number()),
      requiredConfidenceFloor: v.optional(v.number()),
      formatSchema: v.optional(v.string()),
    })),
    budgetTokens: v.optional(v.number()),
    budgetCostUsd: v.optional(v.number()),
    timeoutMs: v.optional(v.number()),
    entityKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("missions", {
      ...args,
      status: "draft",
      successCriteria: args.successCriteria.map((sc) => ({
        ...sc,
        met: undefined,
        evidence: undefined,
      })),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateMissionStatus = mutation({
  args: {
    missionId: v.id("missions"),
    status: v.union(
      v.literal("draft"),
      v.literal("planned"),
      v.literal("executing"),
      v.literal("judging"),
      v.literal("sniff_check"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, { missionId, status }) => {
    const now = Date.now();
    const patch: Record<string, unknown> = { status, updatedAt: now };
    if (status === "completed" || status === "failed" || status === "cancelled") {
      patch.completedAt = now;
    }
    await ctx.db.patch(missionId, patch);
  },
});

// ---------------------------------------------------------------------------
// Mutations — Task plan lifecycle
// ---------------------------------------------------------------------------

export const addTaskPlan = mutation({
  args: {
    missionId: v.id("missions"),
    taskKey: v.string(),
    title: v.string(),
    description: v.string(),
    order: v.number(),
    dependsOn: v.array(v.string()),
    verifiabilityTier: v.union(
      v.literal("machine_checkable"),
      v.literal("expert_checkable"),
      v.literal("human_sniff_check"),
    ),
    judgeMethod: v.union(
      v.literal("compile_test"),
      v.literal("rubric_8point"),
      v.literal("expert_review"),
      v.literal("human_review"),
      v.literal("auto_pass"),
    ),
    retryBudget: v.number(),
    requiresHumanSniffCheck: v.boolean(),
    stakesLevel: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
    ),
    toolsetAllowlist: v.optional(v.array(v.string())),
    assignedModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("taskPlans", {
      ...args,
      status: "pending",
      assignedAgent: undefined,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const claimTask = mutation({
  args: {
    taskId: v.id("taskPlans"),
    agentId: v.string(),
  },
  handler: async (ctx, { taskId, agentId }) => {
    const task = await ctx.db.get(taskId);
    if (!task || task.status !== "pending") return null;

    // Check dependencies are met
    if (task.dependsOn.length > 0) {
      const allTasks = await ctx.db
        .query("taskPlans")
        .withIndex("by_mission_status", (q) => q.eq("missionId", task.missionId))
        .collect();

      const depsMet = task.dependsOn.every((depKey) => {
        const dep = allTasks.find((t) => t.taskKey === depKey);
        return dep?.status === "completed";
      });

      if (!depsMet) {
        await ctx.db.patch(taskId, { status: "blocked", updatedAt: Date.now() });
        return null;
      }
    }

    await ctx.db.patch(taskId, {
      status: "in_progress",
      assignedAgent: agentId,
      updatedAt: Date.now(),
    });

    return task;
  },
});

export const completeTask = mutation({
  args: {
    taskId: v.id("taskPlans"),
    resultSummary: v.optional(v.string()),
  },
  handler: async (ctx, { taskId, resultSummary }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return;

    // Move to judging — don't mark completed until judge passes
    await ctx.db.patch(taskId, {
      status: "judging",
      updatedAt: Date.now(),
    });

    // If requires sniff check, that happens after judge pass
    return { taskId, missionId: task.missionId, needsJudge: true };
  },
});

// ---------------------------------------------------------------------------
// Mutations — Run steps (receipt-like per-step tracking)
// ---------------------------------------------------------------------------

export const recordRunStep = mutation({
  args: {
    taskId: v.id("taskPlans"),
    missionId: v.id("missions"),
    stepNumber: v.number(),
    action: v.string(),
    target: v.optional(v.string()),
    reason: v.string(),
    toolUsed: v.optional(v.string()),
    modelUsed: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("retrying"),
    ),
    resultSummary: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    errorCategory: v.optional(v.union(
      v.literal("transient"),
      v.literal("permanent"),
      v.literal("rate_limit"),
      v.literal("timeout"),
      v.literal("contract_violation"),
      v.literal("hallucination"),
    )),
  },
  handler: async (ctx, args) => {
    // BUDGET ENFORCEMENT: Check accumulated cost against mission budget before recording
    const mission = await ctx.db.get(args.missionId);
    if (mission) {
      const budgetCostUsd = mission.budgetCostUsd;
      const budgetTokens = mission.budgetTokens;
      if (budgetCostUsd != null || budgetTokens != null) {
        const priorSteps = await ctx.db
          .query("runSteps")
          .withIndex("by_mission_created", (q: any) => q.eq("missionId", args.missionId))
          .collect();
        // BOUND: cap in-memory accumulation to first 2000 steps
        const bounded = priorSteps.slice(0, 2000);
        const totalCost = bounded.reduce((sum, s) => sum + (s.costUsd ?? 0), 0) + (args.costUsd ?? 0);
        const totalTokens = bounded.reduce((sum, s) => sum + (s.inputTokens ?? 0) + (s.outputTokens ?? 0), 0)
          + (args.inputTokens ?? 0) + (args.outputTokens ?? 0);
        if (budgetCostUsd != null && totalCost > budgetCostUsd) {
          throw new Error(`Mission budget exceeded: $${totalCost.toFixed(4)} > $${budgetCostUsd.toFixed(4)} limit`);
        }
        if (budgetTokens != null && totalTokens > budgetTokens) {
          throw new Error(`Mission token budget exceeded: ${totalTokens} > ${budgetTokens} limit`);
        }
      }
    }

    return ctx.db.insert("runSteps", {
      ...args,
      artifactIds: undefined,
      evidenceRefs: undefined,
      receiptId: undefined,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Mutations — Judge reviews
// ---------------------------------------------------------------------------

export const recordJudgeReview = mutation({
  args: {
    taskId: v.id("taskPlans"),
    missionId: v.id("missions"),
    judgeModel: v.string(),
    verdict: v.union(
      v.literal("pass"),
      v.literal("partial"),
      v.literal("fail"),
      v.literal("escalate"),
    ),
    criteria: v.object({
      taskCompleted: v.boolean(),
      outputCorrect: v.boolean(),
      evidenceCited: v.boolean(),
      noHallucination: v.boolean(),
      toolsUsedEfficiently: v.boolean(),
      contractFollowed: v.boolean(),
      budgetRespected: v.boolean(),
      noForbiddenActions: v.boolean(),
    }),
    compositeConfidence: v.number(),
    reasoning: v.string(),
    failures: v.optional(v.array(v.string())),
    recommendation: v.union(
      v.literal("promote"),
      v.literal("retry"),
      v.literal("escalate_human"),
      v.literal("fail_permanent"),
    ),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // HONEST_SCORES: Clamp compositeConfidence to [0, 1]
    const clampedConfidence = Math.max(0, Math.min(1, args.compositeConfidence));

    const reviewId = await ctx.db.insert("judgeReviews", {
      ...args,
      compositeConfidence: clampedConfidence,
      customCriteria: undefined,
      createdAt: Date.now(),
    });

    const [task, mission] = await Promise.all([
      ctx.db.get(args.taskId),
      ctx.db.get(args.missionId),
    ]);

    // ERROR_BOUNDARY: Decision memory is advisory — never block judge review storage
    if (mission) {
      try {
        const fingerprint = await createDecisionFingerprint({
          actionType: task?.taskKey ?? mission.missionType,
          domain: mission.missionType,
          entityRef: mission.entityKey,
        });

        await ctx.db.insert("decisionMemory", {
          fingerprint,
          entityRef: mission.entityKey,
          actionType: task?.taskKey ?? mission.missionType,
          domain: mission.missionType,
          verdict: args.verdict,
          confidence: clampedConfidence,
          reasoning: args.reasoning,
          sourceJudgeReviewId: reviewId,
          sourceMissionId: args.missionId,
          createdAt: Date.now(),
        });
      } catch (_err) {
        // Advisory: decision memory failure must not block the judge review
        console.warn("Decision memory insert failed for judge review", reviewId);
      }
    }

    // Update task status based on verdict
    if (!task) return reviewId;

    if (args.recommendation === "promote") {
      if (task.requiresHumanSniffCheck) {
        await ctx.db.patch(args.taskId, { status: "sniff_check", updatedAt: Date.now() });
        // Create sniff check entry
        await ctx.db.insert("sniffChecks", {
          taskId: args.taskId,
          missionId: args.missionId,
          status: "pending",
          reviewType: "general",
          outputSummary: args.reasoning,
          createdAt: Date.now(),
        });
      } else {
        await ctx.db.patch(args.taskId, {
          status: "completed",
          completedAt: Date.now(),
          updatedAt: Date.now(),
        });
        // Unblock dependent tasks
        await unblockDependents(ctx, task.missionId, task.taskKey);
      }
    } else if (args.recommendation === "retry") {
      if (task.retryCount < task.retryBudget) {
        await ctx.db.patch(args.taskId, {
          status: "pending",
          retryCount: task.retryCount + 1,
          updatedAt: Date.now(),
        });
        await ctx.db.insert("retryAttempts", {
          taskId: args.taskId,
          missionId: args.missionId,
          attemptNumber: task.retryCount + 1,
          triggerReason: args.reasoning,
          errorCategory: "judge_fail",
          previousJudgeReviewId: reviewId,
          outcome: "fail_retry",
          backoffMs: Math.min(1000 * Math.pow(2, task.retryCount), 30000),
          createdAt: Date.now(),
        });
      } else {
        await ctx.db.patch(args.taskId, { status: "failed", updatedAt: Date.now() });
        await ctx.db.insert("retryAttempts", {
          taskId: args.taskId,
          missionId: args.missionId,
          attemptNumber: task.retryCount + 1,
          triggerReason: `Retry budget exhausted (${task.retryBudget})`,
          errorCategory: "judge_fail",
          previousJudgeReviewId: reviewId,
          outcome: "fail_exhausted",
          backoffMs: 0,
          createdAt: Date.now(),
        });
      }
    } else if (args.recommendation === "escalate_human") {
      await ctx.db.patch(args.taskId, { status: "sniff_check", updatedAt: Date.now() });
      await ctx.db.insert("sniffChecks", {
        taskId: args.taskId,
        missionId: args.missionId,
        status: "pending",
        reviewType: "general",
        outputSummary: `Judge escalation: ${args.reasoning}`,
        createdAt: Date.now(),
      });
    } else {
      await ctx.db.patch(args.taskId, { status: "failed", updatedAt: Date.now() });
    }

    return reviewId;
  },
});

// ---------------------------------------------------------------------------
// Mutations — Sniff check resolution
// ---------------------------------------------------------------------------

export const resolveSniffCheck = mutation({
  args: {
    sniffCheckId: v.id("sniffChecks"),
    decision: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("needs_revision"),
    ),
    reviewerNotes: v.optional(v.string()),
    reviewedBy: v.optional(v.string()),
  },
  handler: async (ctx, { sniffCheckId, decision, reviewerNotes, reviewedBy }) => {
    const sc = await ctx.db.get(sniffCheckId);
    if (!sc) return;

    await ctx.db.patch(sniffCheckId, {
      status: decision,
      reviewerNotes,
      reviewedBy,
      resolvedAt: Date.now(),
    });

    const task = await ctx.db.get(sc.taskId);
    if (!task) return;

    if (decision === "approved") {
      await ctx.db.patch(sc.taskId, {
        status: "completed",
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await unblockDependents(ctx, task.missionId, task.taskKey);
    } else if (decision === "rejected") {
      await ctx.db.patch(sc.taskId, { status: "failed", updatedAt: Date.now() });
    } else {
      // needs_revision → back to pending for retry
      await ctx.db.patch(sc.taskId, { status: "pending", updatedAt: Date.now() });
    }

    // Check if mission is complete
    await checkMissionCompletion(ctx, task.missionId);
  },
});

// ---------------------------------------------------------------------------
// Mutations — Merge boundaries
// ---------------------------------------------------------------------------

export const recordMerge = mutation({
  args: {
    missionId: v.id("missions"),
    sourceTaskIds: v.array(v.id("taskPlans")),
    mergeStrategy: v.union(
      v.literal("consensus"),
      v.literal("highest_confidence"),
      v.literal("union_dedupe"),
      v.literal("manual"),
    ),
    conflictsDetected: v.number(),
    conflictsResolved: v.number(),
    conflictDetails: v.optional(v.array(v.object({
      description: v.string(),
      resolution: v.string(),
      chosenSource: v.optional(v.string()),
    }))),
    judgeReviewId: v.optional(v.id("judgeReviews")),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("mergeBoundaries", {
      ...args,
      mergedArtifactIds: undefined,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function unblockDependents(
  ctx: { db: any },
  missionId: any,
  completedTaskKey: string,
) {
  const allTasks = await ctx.db
    .query("taskPlans")
    .withIndex("by_mission_status", (q: any) => q.eq("missionId", missionId))
    .collect();

  for (const task of allTasks) {
    if (task.status === "blocked" && task.dependsOn.includes(completedTaskKey)) {
      const depsMet = task.dependsOn.every((depKey: string) => {
        const dep = allTasks.find((t: any) => t.taskKey === depKey);
        return dep?.status === "completed" || depKey === completedTaskKey;
      });
      if (depsMet) {
        await ctx.db.patch(task._id, { status: "pending", updatedAt: Date.now() });
      }
    }
  }
}

async function createDecisionFingerprint({
  entityRef,
  actionType,
  domain,
}: {
  entityRef?: string;
  actionType: string;
  domain: string;
}) {
  const payload = JSON.stringify({
    actionType,
    domain,
    entityRef: entityRef ?? "",
  });
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

async function checkMissionCompletion(ctx: { db: any }, missionId: any) {
  const tasks = await ctx.db
    .query("taskPlans")
    .withIndex("by_mission_status", (q: any) => q.eq("missionId", missionId))
    .collect();

  const allDone = tasks.every(
    (t: any) => t.status === "completed" || t.status === "skipped",
  );
  const anyFailed = tasks.some((t: any) => t.status === "failed");

  if (allDone) {
    await ctx.db.patch(missionId, { status: "completed", completedAt: Date.now(), updatedAt: Date.now() });
  } else if (anyFailed && tasks.filter((t: any) => t.status === "pending" || t.status === "in_progress" || t.status === "blocked").length === 0) {
    await ctx.db.patch(missionId, { status: "failed", completedAt: Date.now(), updatedAt: Date.now() });
  }
}
